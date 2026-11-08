-- A match is played once it has a final_score: unplayed matches are stored with a null score, and
-- writeMatchScore() (src/lib/matchScore.ts) never records 0-0. This matches isPlayedScore()
-- (src/lib/util.ts), which the leaderboard view and rollback_season_schedule_draft() mirror.

create or replace view public.player_season_leaderboard as
select
  w.season_id,
  p.id as player_id,
  p.name as player_name,
  count(pms.id) as matches_played,
  sum(case when pms.is_win = true then 1 else 0 end) as matches_won,
  sum(case when pms.is_win = false then 1 else 0 end) as matches_lost,
  round(((sum(case when pms.is_win = true then 1.0 else 0.0 end) / count(pms.id)::numeric) * 100::numeric), 2) as win_rate_percentage,
  sum(pms.kills) as total_kills,
  sum(pms.deaths) as total_deaths,
  round((sum(pms.kills)::numeric / nullif(sum(pms.deaths), 0)::numeric), 2) as kd_ratio,
  sum(pms.damage) as total_damage,
  sum(pms.rounds_played) as total_rounds_played,
  (sum(pms.damage)::numeric / nullif(sum(pms.rounds_played), 0)::numeric) as overall_adr
from public.player_match_stats pms
  join public.players p on pms.player_id = p.id
  join public.matches m on pms.match_id = m.id
  join public.weeks w on m.week_id = w.id
where m.is_playoff_game = false
  and m.final_score is not null
group by w.season_id, p.id, p.name;

-- Deletes a materialized regular season's weeks where no match has a played score yet. A played
-- match must never be silently deleted, so a week with even one played match is left untouched
-- entirely; the draft rows a confirm materialized from are never touched either way.
create or replace function public.rollback_season_schedule_draft(
  p_season_id integer
)
returns jsonb
language plpgsql
set search_path = public
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
