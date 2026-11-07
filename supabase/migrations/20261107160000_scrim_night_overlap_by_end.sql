-- A night occupies the server from `starts_at` until it ends: the earlier of `ended_at` (set when a
-- player or admin ends it early) and `starts_at` plus the night's length. `start_scrim_night()`
-- refuses a start inside another night's slot, so an ended night frees its slot immediately. The
-- table lock keeps two concurrent starts from both passing the check. Mirrors `scrimNightEnd()` in
-- src/lib/scrim-schedule.ts.

create or replace function public.start_scrim_night(
  p_starts_at timestamptz,
  p_night_minutes integer,
  p_player_id integer,
  p_commitment text
)
returns integer
language plpgsql
set search_path = public
as $function$
declare
  v_night_id integer;
  v_length interval := make_interval(mins => p_night_minutes);
begin
  lock table scrim_nights in share row exclusive mode;
  if exists (
    select 1 from scrim_nights
    where starts_at < p_starts_at + v_length
      and greatest(starts_at, least(starts_at + v_length, ended_at)) > p_starts_at
  ) then
    raise exception 'overlapping-scrim-night' using errcode = 'P0001';
  end if;
  insert into scrim_nights (starts_at) values (p_starts_at) returning id into v_night_id;
  insert into scrim_signups (night_id, player_id, commitment) values (v_night_id, p_player_id, p_commitment);
  return v_night_id;
end;
$function$;
