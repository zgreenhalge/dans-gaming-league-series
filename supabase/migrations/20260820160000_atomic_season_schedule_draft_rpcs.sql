-- Atomic, DB-side counterparts to season-schedule-draft-engine.ts's generate/save/delete/confirm
-- sequences (#320), mirroring the reconcile_gauntlet_draft() pattern: each whole
-- delete/insert-or-update sequence runs as one Postgres transaction instead of several separate
-- Supabase REST calls, so a mid-operation failure rolls back cleanly with no partial state. Every
-- write function opens by calling `lock_and_check_season_materialized()`, which itself takes
-- `select 1 from seasons where id = p_season_id for update` as its first statement — a real row
-- lock that serializes concurrent generate/save/delete/confirm/rollback calls for the same season
-- at the database level, superseding the polled `seasons.schedule_draft_locked_at` column (no
-- application code reads or writes it anymore as of this migration, but it's left in place rather
-- than dropped here — an unused nullable column costs nothing to leave, and keeping it means this
-- migration is purely additive, with nothing destructive to undo if one of these functions needs a
-- fix once this is live; dropping it is a candidate for a later, separate migration once these
-- functions have been running cleanly in production for a while). A caller blocks until the other
-- transaction commits rather than getting an immediate "locked" error; every one of these
-- operations is fast, so that wait is negligible in practice.
--
-- Each already-materialized check runs after acquiring that lock, inside the same transaction as
-- the write it guards, so two concurrent calls (e.g. a generate and a confirm) can't interleave —
-- whichever acquires the lock first fully commits (including its own already-materialized check)
-- before the other's lock wait releases.
--
-- Rollback plan if any of these functions misbehaves once live: every one is `create or replace`,
-- so re-running this migration's old version (or `drop function public.<name>(...)`) is a single
-- statement with nothing else to unwind. None of them drops or alters an existing table/column, so
-- there is no schema state to restore either way.

-- Locks the season row and reports whether it already has a real schedule (`weeks`) — shared by
-- every function below (negated for rollback_season_schedule_draft(), which wants the opposite
-- condition) so the lock-then-check idiom exists in exactly one place rather than being repeated,
-- with the exact definition of "materialized" copy-pasted, in each caller.
create or replace function public.lock_and_check_season_materialized(p_season_id integer)
returns boolean
language plpgsql
as $function$
begin
  perform 1 from seasons where id = p_season_id for update;
  return exists (select 1 from weeks where season_id = p_season_id);
end;
$function$;

-- Deletes a season's entire draft (matches before weeks, for the FK) — shared by
-- generate_season_schedule_draft() (which always fully replaces the draft) and
-- delete_season_schedule_draft() (which is exactly this and nothing else).
create or replace function public.clear_season_schedule_draft(p_season_id integer)
returns void
language plpgsql
as $function$
begin
  delete from season_schedule_draft_matches
  where draft_week_id in (select id from season_schedule_draft_weeks where season_id = p_season_id);
  delete from season_schedule_draft_weeks where season_id = p_season_id;
end;
$function$;

create or replace function public.generate_season_schedule_draft(
  p_season_id integer,
  p_weeks jsonb
)
returns jsonb
language plpgsql
as $function$
declare
  week jsonb;
  match jsonb;
  new_week_id integer;
begin
  if lock_and_check_season_materialized(p_season_id) then
    return jsonb_build_object('status', 'already-materialized');
  end if;

  perform clear_season_schedule_draft(p_season_id);

  for week in select * from jsonb_array_elements(p_weeks)
  loop
    insert into season_schedule_draft_weeks (season_id, week_number, bye_player_id)
    values (p_season_id, (week->>'week_number')::integer, (week->>'bye_player_id')::integer)
    returning id into new_week_id;

    for match in select * from jsonb_array_elements(week->'matches')
    loop
      insert into season_schedule_draft_matches (
        draft_week_id, match_number, shirts_player1_id, shirts_player2_id, skins_player1_id, skins_player2_id
      )
      values (
        new_week_id,
        (match->>'match_number')::integer,
        (match->>'shirts_player1_id')::integer,
        (match->>'shirts_player2_id')::integer,
        (match->>'skins_player1_id')::integer,
        (match->>'skins_player2_id')::integer
      );
    end loop;
  end loop;

  return jsonb_build_object('status', 'ok');
end;
$function$;

create or replace function public.save_season_schedule_draft(
  p_season_id integer,
  p_weeks jsonb
)
returns jsonb
language plpgsql
as $function$
declare
  week jsonb;
  match jsonb;
  week_id integer;
begin
  if lock_and_check_season_materialized(p_season_id) then
    return jsonb_build_object('status', 'already-materialized');
  end if;

  for week in select * from jsonb_array_elements(p_weeks)
  loop
    select id into week_id
    from season_schedule_draft_weeks
    where season_id = p_season_id and week_number = (week->>'week_number')::integer;

    if week_id is null then
      raise exception 'save_season_schedule_draft: no draft week % exists for season %', week->>'week_number', p_season_id;
    end if;

    update season_schedule_draft_weeks
    set bye_player_id = (week->>'bye_player_id')::integer
    where id = week_id;

    for match in select * from jsonb_array_elements(week->'matches')
    loop
      update season_schedule_draft_matches
      set shirts_player1_id = (match->>'shirts_player1_id')::integer,
          shirts_player2_id = (match->>'shirts_player2_id')::integer,
          skins_player1_id = (match->>'skins_player1_id')::integer,
          skins_player2_id = (match->>'skins_player2_id')::integer
      where draft_week_id = week_id and match_number = (match->>'match_number')::integer;

      if not found then
        raise exception 'save_season_schedule_draft: no draft match % in week % exists for season %',
          match->>'match_number', week->>'week_number', p_season_id;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('status', 'ok');
end;
$function$;

create or replace function public.delete_season_schedule_draft(
  p_season_id integer
)
returns jsonb
language plpgsql
as $function$
begin
  if lock_and_check_season_materialized(p_season_id) then
    return jsonb_build_object('status', 'already-materialized');
  end if;

  perform clear_season_schedule_draft(p_season_id);

  return jsonb_build_object('status', 'ok');
end;
$function$;

-- Materializes the exact `p_weeks` snapshot the caller already validated
-- (validateDraftIntegrity()/validateDraftCompleteness() in season-schedule-draft-engine.ts), rather
-- than re-reading season_schedule_draft_weeks/_matches itself — a concurrent
-- save_season_schedule_draft() call landing between that validation and this call could otherwise
-- change what's persisted in those tables without changing what was actually validated, and this
-- function would materialize that unvalidated edit instead. Materializing the passed snapshot
-- directly guarantees whatever becomes real always passed validation. It does NOT guarantee the
-- newest edit wins: if a concurrent save commits in that same window, this call still materializes
-- the older (but valid) snapshot it already had in hand, and the save's edit is simply never
-- reflected in what gets confirmed — the row lock only serializes the two functions' own SQL
-- against each other, not the JS-side read/validate step that happens before either is called. This
-- residual window is accepted rather than closed with an optimistic-concurrency/version check: it
-- can only ever discard a valid, already-persisted edit (never corrupt data or double-materialize),
-- and this tooling doesn't see concurrent admins editing the same season's draft in practice.
create or replace function public.confirm_season_schedule_draft(
  p_season_id integer,
  p_weeks jsonb
)
returns jsonb
language plpgsql
as $function$
declare
  week jsonb;
  match jsonb;
  new_week_id integer;
  new_match_id integer;
  weeks_created integer := 0;
  matches_created integer := 0;
begin
  if lock_and_check_season_materialized(p_season_id) then
    return jsonb_build_object('status', 'already-materialized');
  end if;

  for week in select * from jsonb_array_elements(p_weeks)
  loop
    insert into weeks (season_id, week_number, bye_player_id)
    values (p_season_id, (week->>'week_number')::integer, (week->>'bye_player_id')::integer)
    returning id into new_week_id;
    weeks_created := weeks_created + 1;

    for match in select * from jsonb_array_elements(week->'matches')
    loop
      insert into matches (
        week_id, match_number, is_playoff_game, final_score, picked_map,
        shirts_ban, shirts_ban2, skins_ban1, skins_ban2, shirts_pick, skins_starting_side
      )
      values (
        new_week_id, (match->>'match_number')::integer, false, null, null,
        null, null, null, null, null, null
      )
      returning id into new_match_id;
      matches_created := matches_created + 1;

      insert into player_match_stats (
        match_id, player_id, faction, kills, assists, deaths, damage, adr, rounds_played, rounds_won, is_win
      )
      values
        (new_match_id, (match->>'shirts_player1_id')::integer, 'SHIRTS', 0, 0, 0, 0, 0, 0, 0, false),
        (new_match_id, (match->>'shirts_player2_id')::integer, 'SHIRTS', 0, 0, 0, 0, 0, 0, 0, false),
        (new_match_id, (match->>'skins_player1_id')::integer, 'SKINS', 0, 0, 0, 0, 0, 0, 0, false),
        (new_match_id, (match->>'skins_player2_id')::integer, 'SKINS', 0, 0, 0, 0, 0, 0, 0, false);
    end loop;
  end loop;

  return jsonb_build_object('status', 'confirmed', 'weeks_created', weeks_created, 'matches_created', matches_created);
end;
$function$;

-- Scoped rollback (un-confirm): deletes a confirmed season's real `weeks` (cascading `matches` /
-- `player_match_stats` and everything keyed off them — all `on delete cascade`), restricted to
-- weeks where no match has a played score yet. A played match must never be silently deleted, so a
-- week with even one played match is left untouched entirely; the draft rows a confirm materialized
-- from are never touched either way (confirm never mutates them, so they're still there to
-- re-confirm from once its blocking already-materialized week is dealt with by hand). "Played"
-- mirrors isPlayedScore() (src/lib/util.ts): a non-null final_score that isn't the S3-style "0-0"
-- placeholder.
create or replace function public.rollback_season_schedule_draft(
  p_season_id integer
)
returns jsonb
language plpgsql
as $function$
declare
  deletable_week_ids integer[];
  protected_week_numbers integer[];
begin
  if not lock_and_check_season_materialized(p_season_id) then
    return jsonb_build_object('status', 'not-materialized');
  end if;

  select coalesce(array_agg(w.id), '{}') into deletable_week_ids
  from weeks w
  where w.season_id = p_season_id
    and not exists (
      select 1 from matches m
      where m.week_id = w.id
        and m.final_score is not null
        and m.final_score !~ '^\s*0\s*[-–]\s*0\s*$'
    );

  select coalesce(array_agg(w.week_number order by w.week_number), '{}') into protected_week_numbers
  from weeks w
  where w.season_id = p_season_id and w.id != all(deletable_week_ids);

  delete from weeks where id = any(deletable_week_ids);

  return jsonb_build_object(
    'status', 'rolled-back',
    'weeks_deleted', coalesce(array_length(deletable_week_ids, 1), 0),
    'protected_week_numbers', to_jsonb(protected_week_numbers)
  );
end;
$function$;
