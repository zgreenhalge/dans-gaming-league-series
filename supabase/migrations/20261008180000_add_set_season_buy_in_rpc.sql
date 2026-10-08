-- Sets an UPCOMING regular season's buy-in, guarded by the same rule the admin UI shows: the
-- buy-in is editable only until the season's schedule is generated (a matchup draft or a confirmed
-- schedule exists).
--
-- The season row is locked `for update` before anything is checked. Every schedule-draft write
-- function takes that same lock first (`lock_and_check_season_materialized()`), so a buy-in change
-- and a schedule generation for one season run one after the other, and the status and schedule
-- checks below always see the other's committed result.
--
-- Returns `{ "status": ... }`: `ok`, `not-found` (no such regular season), `not-upcoming`, or
-- `schedule-generated`. Nothing is written unless the status is `ok`.
create or replace function public.set_season_buy_in(
  p_season_id integer,
  p_amount numeric
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_status text;
  v_is_gauntlet boolean;
begin
  select status, is_gauntlet into v_status, v_is_gauntlet
  from public.seasons
  where id = p_season_id
  for update;

  if not found or v_is_gauntlet then
    return jsonb_build_object('status', 'not-found');
  end if;
  if v_status <> 'UPCOMING' then
    return jsonb_build_object('status', 'not-upcoming');
  end if;
  if exists (select 1 from public.season_schedule_draft_weeks where season_id = p_season_id)
    or exists (select 1 from public.weeks where season_id = p_season_id) then
    return jsonb_build_object('status', 'schedule-generated');
  end if;

  update public.seasons set buy_in_amount = p_amount where id = p_season_id;
  return jsonb_build_object('status', 'ok');
end;
$function$;

revoke all on function public.set_season_buy_in(integer, numeric) from public, anon, authenticated;
