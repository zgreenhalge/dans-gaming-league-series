-- delete_upcoming_season() (supabase/migrations/20261112120000_delete_upcoming_season.sql).
-- Run with `npx supabase test db` against the local stack (docs/e2e.md). Everything happens inside
-- one transaction that rolls back, so the stack's data is untouched.
begin;
select plan(11);

-- Fixtures: ids are explicit so the assertions can name them. Players 1-4 come from supabase/seed.sql.
--   9001 UPCOMING with a roster and a schedule draft   (the season the success case deletes)
--   9002 UPCOMING with a roster and a schedule draft   (a bystander that must survive)
--   9003 ACTIVE with a roster                          (refused: season-not-upcoming)
--   9004 UPCOMING gauntlet with a roster               (refused: season-not-upcoming)
--   9005 UPCOMING with a roster and a real week        (refused: season-has-schedule)
insert into seasons (id, name, status, is_gauntlet) values
  (9001, 'pgtap upcoming target', 'UPCOMING', false),
  (9002, 'pgtap upcoming bystander', 'UPCOMING', false),
  (9003, 'pgtap active', 'UPCOMING', false),
  (9004, 'pgtap gauntlet', 'UPCOMING', true),
  (9005, 'pgtap scheduled', 'UPCOMING', false);

-- A roster can only change while the season is UPCOMING, so seat it before activating 9003.
insert into season_players (season_id, player_id)
select s.id, p.id from (values (9001), (9002), (9003), (9004), (9005)) as s(id), (values (1), (2)) as p(id);
update seasons set status = 'ACTIVE' where id = 9003;

insert into season_schedule_draft_weeks (id, season_id, week_number) values (9001, 9001, 1), (9002, 9002, 1);
insert into season_schedule_draft_matches
  (draft_week_id, match_number, shirts_player1_id, shirts_player2_id, skins_player1_id, skins_player2_id)
values (9001, 1, 1, 2, 3, 4), (9002, 1, 1, 2, 3, 4);

insert into weeks (season_id, week_number) values (9005, 1);

-- Refusals: each raises its own code and deletes nothing.
select throws_ok($$select delete_upcoming_season(9999)$$, 'P0001', 'season-not-found', 'a missing season is refused');
select throws_ok($$select delete_upcoming_season(9003)$$, 'P0001', 'season-not-upcoming', 'an ACTIVE season is refused');
select throws_ok($$select delete_upcoming_season(9004)$$, 'P0001', 'season-not-upcoming', 'a gauntlet season is refused');
select throws_ok($$select delete_upcoming_season(9005)$$, 'P0001', 'season-has-schedule', 'a season with real weeks is refused');

select is((select count(*)::int from seasons where id between 9001 and 9005), 5, 'refusals delete no season');
select is((select count(*)::int from season_players where season_id between 9001 and 9005), 10, 'refusals delete no roster row');
select is((select count(*)::int from season_schedule_draft_weeks where season_id between 9001 and 9005), 2, 'refusals delete no draft week');
select is((select count(*)::int from season_schedule_draft_matches where draft_week_id in (9001, 9002)), 2, 'refusals delete no draft match');

-- Success: only season 9001's draft, roster and season row go.
select lives_ok($$select delete_upcoming_season(9001)$$, 'an UPCOMING season with no schedule is deleted');
select is(
  (select count(*)::int from seasons where id = 9001)
    + (select count(*)::int from season_players where season_id = 9001)
    + (select count(*)::int from season_schedule_draft_weeks where season_id = 9001)
    + (select count(*)::int from season_schedule_draft_matches where draft_week_id = 9001),
  0, 'the season, its roster and its draft are gone');
select is(
  (select array[
      (select count(*)::int from seasons where id between 9002 and 9005),
      (select count(*)::int from season_players where season_id between 9002 and 9005),
      (select count(*)::int from season_schedule_draft_weeks where season_id = 9002),
      (select count(*)::int from season_schedule_draft_matches where draft_week_id = 9002),
      (select count(*)::int from weeks where season_id = 9005)]),
  array[4, 8, 1, 1, 1], 'other seasons, rosters, drafts and weeks are untouched');

select * from finish();
rollback;
