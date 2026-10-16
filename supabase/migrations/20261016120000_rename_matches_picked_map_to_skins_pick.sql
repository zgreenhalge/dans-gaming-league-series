-- `matches.skins_pick` pairs with `matches.shirts_pick`: the map SKINS picked in the regular veto
-- flow. The gauntlet auto-pick always lands in `shirts_pick`, so `skins_pick` is never written for a
-- gauntlet match; resolve the played map with `effectivePickedMap()` (src/lib/veto.ts).
alter table public.matches rename column picked_map to skins_pick;

-- plpgsql bodies are stored as text, so the rename does not reach them: re-create the one function
-- that names the column. `set search_path = public` keeps the pin from
-- 20261009150100_pin_function_search_path.sql (create-or-replace resets function settings).
create or replace function public.confirm_season_schedule_draft(
  p_season_id integer,
  p_weeks jsonb
)
returns jsonb
language plpgsql
set search_path = public
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
        week_id, match_number, is_playoff_game, final_score, skins_pick,
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
