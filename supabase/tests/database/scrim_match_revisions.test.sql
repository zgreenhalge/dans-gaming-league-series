-- update_scrim_match(), discard_scrim_match() and claim_scrim_match_start()
-- (supabase/migrations/20261110130000_add_scrim_match_revision.sql and
-- 20261115130000_claim_scrim_match_start_retry.sql).
-- Run with `npx supabase test db` against the local stack (docs/e2e.md). Everything happens inside
-- one transaction that rolls back, so the stack's data is untouched.
begin;
select plan(29);

-- Fixtures: ids are explicit so the assertions can name them. Players 1-4 come from supabase/seed.sql.
--   9001 scrim match at revision 0                 (the change / claim / stale-revision cases)
--   9002 scrim match, server `provisioning`        (holds the server)
--   9003 scrim match, server `live`
--   9004 scrim match, server `tearing_down`
--   9005 scrim match, server `done`
--   9006 scrim match with a final score
--   9007 scrim match, server `failed`, revision 5  (a retry claims it from its current revision)
--   9008 scrim match to discard at its current revision
--   9009 a league match (week_id, no scrim night)
delete from scrim_nights;
insert into scrim_nights (id, starts_at) values (9001, now());
insert into seasons (id, name, status, is_gauntlet) values (9001, 'pgtap scrim revisions', 'UPCOMING', false);
insert into weeks (id, season_id, week_number) values (9001, 9001, 1);
insert into matches (id, match_number, scrim_night_id, week_id, scrim_side_choice, scrim_revision, final_score) values
  (9001, 1, 9001, null, 'random', 0, null),
  (9002, 2, 9001, null, 'random', 0, null),
  (9003, 3, 9001, null, 'random', 0, null),
  (9004, 4, 9001, null, 'random', 0, null),
  (9005, 5, 9001, null, 'random', 0, null),
  (9006, 6, 9001, null, 'random', 0, '13-9'),
  (9007, 7, 9001, null, 'random', 5, null),
  (9008, 8, 9001, null, 'random', 0, null),
  (9009, 1, null, 9001, null, 0, null);
insert into match_server_state (match_id, server_state) values
  (9002, 'provisioning'), (9003, 'live'), (9004, 'tearing_down'), (9005, 'done'), (9007, 'failed');

-- update_scrim_match: a current revision changes the match and bumps it.
select is(
  update_scrim_match(9001, 0, 'de_pgtap', '12345', 'knife', array[1, 2], array[3, 4]),
  1, 'a change at the current revision returns the new revision');
select is(
  (select array[shirts_pick, scrim_workshop_id, scrim_side_choice, scrim_revision::text] from matches where id = 9001),
  array['de_pgtap', '12345', 'knife', '1'], 'the change sets map, workshop id, side choice and revision');
select is((select count(*)::int from player_match_stats where match_id = 9001), 4, 'the change seats the lineup');

-- A null argument leaves that part as it is.
select is(update_scrim_match(9001, 1, null, null, null, null, null), 2, 'a change with only nulls still bumps the revision');
select is(
  (select array[shirts_pick, scrim_workshop_id, scrim_side_choice] from matches where id = 9001),
  array['de_pgtap', '12345', 'knife'], 'null arguments leave the map and side choice as they were');

-- A stale revision is refused and changes nothing.
select throws_ok($$select update_scrim_match(9001, 0, 'de_other', '999', null, null, null)$$, 'P0001', 'scrim-match-changed', 'a stale revision refuses a change');
select is(
  (select array[shirts_pick, scrim_revision::text] from matches where id = 9001),
  array['de_pgtap', '2'], 'a refused change leaves the map and revision alone');
select throws_ok($$select update_scrim_match(9999, 0, null, null, null, null, null)$$, 'P0001', 'scrim-match-changed', 'a missing match refuses a change');
select throws_ok($$select update_scrim_match(9009, 0, null, null, null, null, null)$$, 'P0001', 'Match 9009 is not a scrim match', 'a league match refuses a change');
select throws_ok($$select update_scrim_match(9001, 2, 'de_half', null, null, null, null)$$, 'P0001', 'A scrim map needs both its name and its workshop id', 'a map without its workshop id is refused');

-- claim_scrim_match_start: a claim bumps the revision, so a change or discard from before it is stale.
select is(claim_scrim_match_start(9001, 2), 3, 'a claim at the current revision returns the new revision');
select throws_ok($$select update_scrim_match(9001, 2, 'de_late', '1', null, null, null)$$, 'P0001', 'scrim-match-changed', 'a change from before the claim is refused');
select throws_ok($$select discard_scrim_match(9001, 2)$$, 'P0001', 'scrim-match-changed', 'a discard from before the claim is refused');
select throws_ok($$select claim_scrim_match_start(9001, 2)$$, 'P0001', 'scrim-match-changed', 'a second claim from the same revision is refused');
select is((select count(*)::int from matches where id = 9001), 1, 'the refused discard left the match');
select throws_ok($$select claim_scrim_match_start(9001, null)$$, 'P0001', 'scrim-match-changed', 'a claim with no revision is refused unless the start failed');

-- A match on the server (or already scored) refuses a change, a claim and a discard.
select throws_ok($$select update_scrim_match(9002, 0, null, null, null, null, null)$$, 'P0001', 'scrim-match-locked', 'a provisioning match refuses a change');
select throws_ok($$select claim_scrim_match_start(9002, 0)$$, 'P0001', 'scrim-match-locked', 'a provisioning match refuses a claim');
select throws_ok($$select discard_scrim_match(9002, 0)$$, 'P0001', 'scrim-match-running', 'a provisioning match refuses a discard');
select throws_ok($$select discard_scrim_match(9003, 0)$$, 'P0001', 'scrim-match-running', 'a live match refuses a discard');
select throws_ok($$select discard_scrim_match(9004, 0)$$, 'P0001', 'scrim-match-running', 'a tearing-down match refuses a discard');
select throws_ok($$select update_scrim_match(9005, 0, null, null, null, null, null)$$, 'P0001', 'scrim-match-locked', 'a done match refuses a change');
select throws_ok($$select update_scrim_match(9006, 0, null, null, null, null, null)$$, 'P0001', 'scrim-match-locked', 'a scored match refuses a change');
select throws_ok($$select discard_scrim_match(9006, 0)$$, 'P0001', 'scrim-match-running', 'a scored match refuses a discard');

-- A failed start is claimed again from the current revision, whatever the caller sent, and only once.
select is(claim_scrim_match_start(9007, null), 6, 'a failed start is claimed again with no revision');
select is((select server_state from match_server_state where match_id = 9007), 'provisioning', 'the retry claim moves the server to provisioning');
select throws_ok($$select claim_scrim_match_start(9007, 6)$$, 'P0001', 'scrim-match-locked', 'a second retry finds the match already starting');

-- discard_scrim_match: a current revision deletes the match and its player rows.
select lives_ok($$select discard_scrim_match(9008, 0)$$, 'a discard at the current revision succeeds');
select is((select count(*)::int from matches where id = 9008), 0, 'the discarded match is gone');

select * from finish();
rollback;
