-- A scrim night has no fixed length. It ends when a player or admin ends it (`ended_at`), or once it
-- has been idle for 30 minutes: nothing has happened on it since `greatest(starts_at, last_active_at)`.
-- Activity is a match made, its server changing state (starting, live, game over), a live round score
-- or final score, and a check in or check out. Triggers stamp `last_active_at` on each, so a write
-- from any source counts — a route, the demo-ingest Action, hand-run SQL. A night that has ended stays
-- ended: activity on it afterward (a late score) doesn't revive it; `reopen_scrim_night()` does.
-- Mirrors `scrimNightEnd()` / `SCRIM_NIGHT_IDLE_MS` in src/lib/scrim-schedule.ts.

alter table public.scrim_nights add column last_active_at timestamptz;

-- A night running when this applies keeps running: one not ended by hand that started within the last
-- 4 hours is stamped active now.
update public.scrim_nights
set last_active_at = now()
where ended_at is null
  and starts_at > now() - interval '4 hours';

-- The instant a night ends: `ended_at` (never before it starts), else 30 minutes after its latest
-- activity. A night not ended yet gives the instant it would end if nothing more happened.
create or replace function public.scrim_night_end(
  p_starts_at timestamptz,
  p_ended_at timestamptz,
  p_last_active_at timestamptz
)
returns timestamptz
language sql
immutable
set search_path = public
as $function$
  select case
    when p_ended_at is not null then greatest(p_starts_at, p_ended_at)
    else greatest(p_starts_at, p_last_active_at) + interval '30 minutes'
  end;
$function$;

-- Records activity on night `p_night_id` now, unless it has already ended (a null id is a no-op). A
-- night stamped within the last 5 minutes is left alone: a live match scores far more often than that,
-- and each stamp is a `scrim_nights` update, which bumps `data_version` and so refreshes every cached
-- read. A night therefore goes idle after 25 to 30 minutes of nothing.
create or replace function public.touch_scrim_night(p_night_id integer)
returns void
language sql
set search_path = public
as $function$
  update scrim_nights
  set last_active_at = now()
  where id = p_night_id
    and scrim_night_end(starts_at, ended_at, last_active_at) > now()
    and (last_active_at is null or last_active_at < now() - interval '5 minutes');
$function$;

-- The trigger behind every activity source: the night is the row's own (`scrim_signups.night_id`,
-- `matches.scrim_night_id`) or its match's (`match_server_state`, `live_match_score`).
create or replace function public.touch_scrim_night_on_activity()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_table_name = 'scrim_signups' then
    perform touch_scrim_night(new.night_id);
  elsif tg_table_name = 'matches' then
    perform touch_scrim_night(new.scrim_night_id);
  else
    perform touch_scrim_night((select scrim_night_id from matches where id = new.match_id));
  end if;
  return null;
end;
$function$;

create trigger touch_scrim_night_on_check_in after insert on public.scrim_signups
  for each row when (new.checked_in_at is not null) execute function public.touch_scrim_night_on_activity();
create trigger touch_scrim_night_on_check_in_change after update of checked_in_at on public.scrim_signups
  for each row when (new.checked_in_at is distinct from old.checked_in_at) execute function public.touch_scrim_night_on_activity();
create trigger touch_scrim_night_on_match after insert on public.matches
  for each row when (new.scrim_night_id is not null) execute function public.touch_scrim_night_on_activity();
create trigger touch_scrim_night_on_score after update of final_score on public.matches
  for each row when (new.scrim_night_id is not null and new.final_score is distinct from old.final_score)
  execute function public.touch_scrim_night_on_activity();
create trigger touch_scrim_night_on_server_start after insert on public.match_server_state
  for each row execute function public.touch_scrim_night_on_activity();
create trigger touch_scrim_night_on_server_state after update of server_state on public.match_server_state
  for each row when (new.server_state is distinct from old.server_state) execute function public.touch_scrim_night_on_activity();
create trigger touch_scrim_night_on_live_score after insert or update on public.live_match_score
  for each row execute function public.touch_scrim_night_on_activity();

-- A night occupies the one shared server from `starts_at` until it ends (`scrim_night_end()`).
-- `start_scrim_night()` refuses a start whose slot — from `p_starts_at` until it would go idle — meets
-- another night's, so an ended night frees its slot at once. The table lock keeps two concurrent
-- starts (or a start and a reopen) from both passing the check.
drop function if exists public.start_scrim_night(timestamptz, integer, integer, text);

create function public.start_scrim_night(
  p_starts_at timestamptz,
  p_player_id integer,
  p_commitment text
)
returns integer
language plpgsql
set search_path = public
as $function$
declare
  v_night_id integer;
begin
  lock table scrim_nights in share row exclusive mode;
  if exists (
    select 1 from scrim_nights
    where starts_at < scrim_night_end(p_starts_at, null, null)
      and scrim_night_end(starts_at, ended_at, last_active_at) > p_starts_at
  ) then
    raise exception 'overlapping-scrim-night' using errcode = 'P0001';
  end if;
  insert into scrim_nights (starts_at) values (p_starts_at) returning id into v_night_id;
  insert into scrim_signups (night_id, player_id, commitment) values (v_night_id, p_player_id, p_commitment);
  return v_night_id;
end;
$function$;

-- Reopens a night that has ended: clears `ended_at` and counts now as activity, so it is current
-- again until it is ended or goes idle. Refuses while another night holds the server from now until
-- the reopened night would go idle — one that is current, or starts in that time. Who may reopen,
-- and how long after its start, is the route's gate (`requireScrimNightReopenAccess()`). Called from
-- src/lib/scrim-nights.ts (`reopenScrimNight()`).
create function public.reopen_scrim_night(p_night_id integer)
returns void
language plpgsql
set search_path = public
as $function$
begin
  lock table scrim_nights in share row exclusive mode;
  if exists (
    select 1 from scrim_nights
    where id <> p_night_id
      and starts_at < scrim_night_end(now(), null, null)
      and scrim_night_end(starts_at, ended_at, last_active_at) > now()
  ) then
    raise exception 'current-scrim-night' using errcode = 'P0001';
  end if;
  update scrim_nights set ended_at = null, last_active_at = now()
  where id = p_night_id
    and scrim_night_end(starts_at, ended_at, last_active_at) <= now();
  if not found then
    raise exception 'Scrim night % not found or not over', p_night_id;
  end if;
end;
$function$;
