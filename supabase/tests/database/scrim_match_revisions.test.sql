-- update_scrim_match(), discard_scrim_match() and claim_scrim_match_start()
-- (supabase/migrations/20261110130000_add_scrim_match_revision.sql and
-- 20261115130000_claim_scrim_match_start_retry.sql): a stale revision is refused, a claim bumps the
-- revision, and a match already on the server refuses all three.
-- Run with `npx supabase test db` against the local stack (docs/e2e.md). Everything happens inside
-- one transaction that rolls back, so the stack's data is untouched.
begin;
select plan(45);

-- Fixtures: any night already on the local stack is cleared first, inside the transaction. Players
-- 1-4 come from supabase/seed.sql. Every match is on night 9001 at revision 0.
--   9001 changed: map, side, lineup; refused on a stale revision or an incomplete map
--   9002 server states: locks a change, then a discard; a failed start can still change
--   9003 discarded with a lineup (its player rows cascade)
--   9004 claimed; the revision before the claim is stale afterward
--   9005 refuses a claim in each server state
--   9006 failed start, retried from a stale revision
--   9007 already scored: refuses all three
--   9008 failed start, retried with no revision
delete from scrim_nights;
insert into scrim_nights (id, starts_at, ended_at, last_active_at) values
  (9001, now() - interval '30 minutes', null, null);
insert into matches (id, scrim_night_id, match_number, shirts_pick, scrim_workshop_id, scrim_side_choice, skins_starting_side)
select n, 9001, n - 9000, 'foroglio', '111', 'knife', case when n = 9001 then 't' end from generate_series(9001, 9008) as n;
update matches set final_score = '13-9' where id = 9007;
do $$ begin perform set_scrim_match_lineup(9003, array[1, 2], array[3, 4]); end $$;
insert into match_server_state (match_id, server_state) values (9002, 'provisioning'), (9005, 'provisioning'), (9006, 'failed'), (9008, 'failed');

-- update_scrim_match(): a stale or missing match is refused and changes nothing.
select throws_ok($$select update_scrim_match(9001, 5, 'ganny', '222', null, null, null)$$, 'P0001', 'scrim-match-changed', 'a stale revision refuses a change');
select is((select array[scrim_revision::text, shirts_pick] from matches where id = 9001), array['0', 'foroglio'], 'a refused change leaves the match as it was');
select throws_ok($$select update_scrim_match(9999, 0, 'ganny', '222', null, null, null)$$, 'P0001', 'scrim-match-changed', 'a missing match refuses a change');

-- A change at the current revision applies and bumps it; null arguments leave their part alone.
select is(update_scrim_match(9001, 0, 'ganny', '222', 'skins_t', null, null), 1, 'a change returns the new revision');
select is(
  (select array[shirts_pick, scrim_workshop_id, scrim_side_choice, scrim_revision::text] from matches where id = 9001),
  array['ganny', '222', 'skins_t', '1'], 'a change sets the map, workshop id and side');
select is((select skins_starting_side from matches where id = 9001), null, 'a side choice clears the side an earlier start resolved');
select is(update_scrim_match(9001, 1, null, null, null, null, null), 2, 'a change of nothing still bumps the revision');
select is((select array[shirts_pick, scrim_side_choice] from matches where id = 9001), array['ganny', 'skins_t'], 'null arguments leave the map and side as they were');
select is(update_scrim_match(9001, 2, null, null, null, array[1, 2], array[3, 4]), 3, 'a lineup change returns the new revision');
select is((select count(*)::int from player_match_stats where match_id = 9001), 4, 'a lineup change seats four players');
select throws_ok($$select update_scrim_match(9001, 3, 'palais', null, null, null, null)$$, 'P0001', 'A scrim map needs both its name and its workshop id', 'a map without its workshop id is refused');
select is((select scrim_revision from matches where id = 9001), 3, 'a refused map leaves the revision as it was');

-- update_scrim_match(): refused once the match holds the server or has a score.
select throws_ok($$select update_scrim_match(9002, 0, 'ganny', '222', null, null, null)$$, 'P0001', 'scrim-match-locked', 'a provisioning match refuses a change');
update match_server_state set server_state = 'live' where match_id = 9002;
select throws_ok($$select update_scrim_match(9002, 0, 'ganny', '222', null, null, null)$$, 'P0001', 'scrim-match-locked', 'a live match refuses a change');
update match_server_state set server_state = 'tearing_down' where match_id = 9002;
select throws_ok($$select update_scrim_match(9002, 0, 'ganny', '222', null, null, null)$$, 'P0001', 'scrim-match-locked', 'a tearing-down match refuses a change');
update match_server_state set server_state = 'done' where match_id = 9002;
select throws_ok($$select update_scrim_match(9002, 0, 'ganny', '222', null, null, null)$$, 'P0001', 'scrim-match-locked', 'a finished match refuses a change');
select throws_ok($$select update_scrim_match(9007, 0, 'ganny', '222', null, null, null)$$, 'P0001', 'scrim-match-locked', 'a scored match refuses a change');
update match_server_state set server_state = 'failed' where match_id = 9002;
select is(update_scrim_match(9002, 0, 'ganny', '222', null, null, null), 1, 'a match whose server failed can still change');

-- discard_scrim_match(): refused while the match holds the server or has a score.
update match_server_state set server_state = 'provisioning' where match_id = 9002;
select throws_ok($$select discard_scrim_match(9002, 1)$$, 'P0001', 'scrim-match-running', 'a provisioning match refuses a discard');
update match_server_state set server_state = 'live' where match_id = 9002;
select throws_ok($$select discard_scrim_match(9002, 1)$$, 'P0001', 'scrim-match-running', 'a live match refuses a discard');
update match_server_state set server_state = 'tearing_down' where match_id = 9002;
select throws_ok($$select discard_scrim_match(9002, 1)$$, 'P0001', 'scrim-match-running', 'a tearing-down match refuses a discard');
select throws_ok($$select discard_scrim_match(9007, 0)$$, 'P0001', 'scrim-match-running', 'a scored match refuses a discard');
update match_server_state set server_state = 'done' where match_id = 9002;
select lives_ok($$select discard_scrim_match(9002, 1)$$, 'a finished match with no score is discarded');
select is((select count(*)::int from matches where id = 9002), 0, 'the discarded match is gone');

-- discard_scrim_match(): a stale or missing match is refused and deletes nothing; success cascades.
select throws_ok($$select discard_scrim_match(9003, 4)$$, 'P0001', 'scrim-match-changed', 'a stale revision refuses a discard');
select throws_ok($$select discard_scrim_match(9999, 0)$$, 'P0001', 'scrim-match-changed', 'a missing match refuses a discard');
select is((select count(*)::int from matches where id = 9003), 1, 'a refused discard deletes nothing');
select lives_ok($$select discard_scrim_match(9003, 0)$$, 'a match at the current revision is discarded');
select is(
  (select count(*)::int from matches where id = 9003) + (select count(*)::int from player_match_stats where match_id = 9003),
  0, 'a discard removes the match and its player rows');

-- claim_scrim_match_start(): a stale revision is refused (a missing one too, unless the start failed).
select throws_ok($$select claim_scrim_match_start(9004, 3)$$, 'P0001', 'scrim-match-changed', 'a stale revision refuses a claim');
select throws_ok($$select claim_scrim_match_start(9004, null)$$, 'P0001', 'scrim-match-changed', 'no revision refuses a claim unless the start failed');

-- A claim bumps the revision, so a client holding the one before it is refused.
select is(claim_scrim_match_start(9004, 0), 1, 'a claim returns the new revision');
select throws_ok($$select update_scrim_match(9004, 0, 'ganny', '222', null, null, null)$$, 'P0001', 'scrim-match-changed', 'a claim refuses a change from before it');
select throws_ok($$select discard_scrim_match(9004, 0)$$, 'P0001', 'scrim-match-changed', 'a claim refuses a discard from before it');
select is((select scrim_revision from matches where id = 9004), 1, 'the refusals leave the claimed revision as it was');

-- A match already starting, running or scored refuses a claim, at its current revision.
select throws_ok($$select claim_scrim_match_start(9005, 0)$$, 'P0001', 'scrim-match-locked', 'a provisioning match refuses a claim');
update match_server_state set server_state = 'live' where match_id = 9005;
select throws_ok($$select claim_scrim_match_start(9005, 0)$$, 'P0001', 'scrim-match-locked', 'a live match refuses a claim');
update match_server_state set server_state = 'tearing_down' where match_id = 9005;
select throws_ok($$select claim_scrim_match_start(9005, 0)$$, 'P0001', 'scrim-match-locked', 'a tearing-down match refuses a claim');
update match_server_state set server_state = 'done' where match_id = 9005;
select throws_ok($$select claim_scrim_match_start(9005, 0)$$, 'P0001', 'scrim-match-locked', 'a finished match refuses a claim');
select throws_ok($$select claim_scrim_match_start(9007, 0)$$, 'P0001', 'scrim-match-locked', 'a scored match refuses a claim');
select is((select array[(select scrim_revision from matches where id = 9005), (select scrim_revision from matches where id = 9007)]), array[0, 0], 'refused claims bump no revision');

-- A start whose boot failed is claimed again whatever revision the caller holds, and moves the match
-- to provisioning under the same lock, so a second retry is refused.
select is(claim_scrim_match_start(9006, 99), 1, 'a failed start is claimed again from a stale revision');
select is((select server_state from match_server_state where match_id = 9006), 'provisioning', 'claiming a failed start sets it provisioning');
select throws_ok($$select claim_scrim_match_start(9006, null)$$, 'P0001', 'scrim-match-locked', 'a second retry is refused once the start is claimed');
select is(claim_scrim_match_start(9008, null), 1, 'a failed start is claimed again with no revision');

select * from finish();
rollback;
