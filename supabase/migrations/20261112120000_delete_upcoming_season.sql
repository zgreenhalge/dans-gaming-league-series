-- Deletes an UPCOMING regular season outright, as one transaction: its schedule draft, its roster
-- (`season_players`) and the `seasons` row itself land together or not at all. The function locks the
-- season row first and runs its checks under that lock, so a schedule confirmed by another request
-- (`confirm_season_schedule_draft()` takes the same lock) can't slip in between the check and the
-- delete. Refuses with:
--   season-not-found     no such season
--   season-not-upcoming  the season is ACTIVE or ARCHIVED, or is a gauntlet season
--   season-has-schedule  the season already has real `weeks`
-- Tables that cascade from `seasons` (`surveys`, `superlatives`, `gauntlet_pods`, ...) go with it.
-- Called from src/lib/season-setup.ts (`deleteUpcomingSeason()`).
create or replace function public.delete_upcoming_season(p_season_id integer)
returns void
language plpgsql
set search_path = public
as $function$
declare
  v_status season_status_type;
  v_is_gauntlet boolean;
begin
  select status, is_gauntlet into v_status, v_is_gauntlet from seasons where id = p_season_id for update;
  if not found then
    raise exception 'season-not-found' using errcode = 'P0001';
  end if;
  if v_status <> 'UPCOMING' or v_is_gauntlet then
    raise exception 'season-not-upcoming' using errcode = 'P0001';
  end if;
  if exists (select 1 from weeks where season_id = p_season_id) then
    raise exception 'season-has-schedule' using errcode = 'P0001';
  end if;

  perform clear_season_schedule_draft(p_season_id);
  delete from season_players where season_id = p_season_id;
  delete from seasons where id = p_season_id;
end;
$function$;

-- The function checks no caller: only the service-role client (an admin route) may run it.
revoke all on function public.delete_upcoming_season(integer) from public, anon, authenticated;
