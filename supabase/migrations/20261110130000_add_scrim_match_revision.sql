-- A scrim match's changes are version-checked. `matches.scrim_revision` counts what has been done to
-- a scrim match through its lobby: each change of map, side or lineup, and each start. Changing,
-- discarding or starting one sends the revision its client saw and is refused (`scrim-match-changed`)
-- when someone else's change landed first, so nobody overwrites, discards or starts a version of the
-- match they never saw. Each takes the match's row lock first, so they serialize, and checks whether
-- the match can still change under that lock. Called from src/lib/scrim-matches.ts.
alter table public.matches add column scrim_revision integer not null default 0;

-- Locks scrim match `p_match_id` for the rest of the transaction. Refuses with `scrim-match-changed`
-- when it is gone (discarded) or its revision is no longer `p_revision`.
create or replace function public.lock_scrim_match_at_revision(p_match_id integer, p_revision integer)
returns void
language plpgsql
set search_path = public
as $function$
declare
  v_scrim_night_id integer;
  v_revision integer;
begin
  select scrim_night_id, scrim_revision into v_scrim_night_id, v_revision
  from matches where id = p_match_id for update;
  if not found then
    raise exception 'scrim-match-changed' using errcode = 'P0001';
  end if;
  if v_scrim_night_id is null then
    raise exception 'Match % is not a scrim match', p_match_id;
  end if;
  if v_revision <> p_revision then
    raise exception 'scrim-match-changed' using errcode = 'P0001';
  end if;
end;
$function$;

-- Changes a scrim match before it starts, in one transaction: its map (`p_map` and `p_workshop_id`
-- together), its starting-side choice (clearing any side an earlier start resolved) and/or its lineup
-- (`set_scrim_match_lineup()`). A null argument leaves that part as it is. Refuses with
-- `scrim-match-locked` once the match has a score or has claimed the server (`provisioning`, `live`,
-- `tearing_down`, `done`; the same rule as `isScrimMatchEditable()`). Returns the new revision.
create or replace function public.update_scrim_match(
  p_match_id integer,
  p_revision integer,
  p_map text,
  p_workshop_id text,
  p_side_choice text,
  p_shirts integer[],
  p_skins integer[]
)
returns integer
language plpgsql
set search_path = public
as $function$
declare
  v_revision integer;
begin
  perform lock_scrim_match_at_revision(p_match_id, p_revision);
  if exists (
    select 1
    from matches m
    left join match_server_state s on s.match_id = m.id
    where m.id = p_match_id
      and (m.final_score is not null or s.server_state in ('provisioning', 'live', 'tearing_down', 'done'))
  ) then
    raise exception 'scrim-match-locked' using errcode = 'P0001';
  end if;
  if (p_map is null) <> (p_workshop_id is null) then
    raise exception 'A scrim map needs both its name and its workshop id';
  end if;

  if p_shirts is not null or p_skins is not null then
    perform set_scrim_match_lineup(p_match_id, p_shirts, p_skins);
  end if;

  -- The match's own row changes in one update, so a subscriber to it gets one event per change.
  update matches
  set shirts_pick = coalesce(p_map, shirts_pick),
      scrim_workshop_id = coalesce(p_workshop_id, scrim_workshop_id),
      scrim_side_choice = coalesce(p_side_choice, scrim_side_choice),
      skins_starting_side = case when p_side_choice is not null then null else skins_starting_side end,
      scrim_revision = scrim_revision + 1
  where id = p_match_id
  returning scrim_revision into v_revision;
  return v_revision;
end;
$function$;

-- Discards a scrim match; its player rows (and anything else keyed to it) cascade. Refuses with
-- `scrim-match-running` once it has a score or while it holds the server (`provisioning`, `live`,
-- `tearing_down`; the same rule as `isScrimMatchDiscardable()`).
create or replace function public.discard_scrim_match(p_match_id integer, p_revision integer)
returns void
language plpgsql
set search_path = public
as $function$
begin
  perform lock_scrim_match_at_revision(p_match_id, p_revision);
  if exists (
    select 1
    from matches m
    left join match_server_state s on s.match_id = m.id
    where m.id = p_match_id
      and (m.final_score is not null or s.server_state in ('provisioning', 'live', 'tearing_down'))
  ) then
    raise exception 'scrim-match-running' using errcode = 'P0001';
  end if;
  delete from matches where id = p_match_id;
end;
$function$;

-- Claims a scrim match's start: bumps its revision, so a change or discard sent from the version
-- before the start is refused. The provision route calls it after its own checks, just before the
-- server boots. Returns the new revision.
create or replace function public.claim_scrim_match_start(p_match_id integer, p_revision integer)
returns integer
language plpgsql
set search_path = public
as $function$
declare
  v_revision integer;
begin
  perform lock_scrim_match_at_revision(p_match_id, p_revision);
  update matches set scrim_revision = scrim_revision + 1 where id = p_match_id
  returning scrim_revision into v_revision;
  return v_revision;
end;
$function$;
