-- `reopen_scrim_night()` refuses a night that is not over (already open, or gone) with its own code,
-- `scrim-night-not-over`, so the caller can tell it from a failure: two players pressing Reopen at
-- once leave the second one facing a night that is no longer over. The other refusal keeps its code,
-- `current-scrim-night` (another night holds the shared server). Called from src/lib/scrim-nights.ts
-- (`reopenScrimNight()`).
create or replace function public.reopen_scrim_night(p_night_id integer)
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
    raise exception 'scrim-night-not-over' using errcode = 'P0001';
  end if;
end;
$function$;
