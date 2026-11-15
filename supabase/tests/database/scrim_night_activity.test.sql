-- Scrim night activity (supabase/migrations/20261110120000_scrim_night_idle_end.sql): which writes
-- stamp `scrim_nights.last_active_at`, and which don't.
-- Run with `npx supabase test db` against the local stack (docs/e2e.md). Everything happens inside
-- one transaction that rolls back, so the stack's data is untouched.
begin;
select plan(21);

-- Fixtures: any night already on the local stack is cleared first, inside the transaction. Players
-- 1-4 come from supabase/seed.sql.
--   9001 started 30 minutes ago, not ended, never active  (current: the night under test)
-- `now()` is fixed for the whole transaction, so a stamp reads back as exactly `now()`, and each case
-- puts `last_active_at` back to null (or a chosen value) first so it starts from a known state.
delete from scrim_nights;
insert into scrim_nights (id, starts_at, ended_at, last_active_at) values
  (9001, now() - interval '30 minutes', null, null);

-- Not activity: a check-in, a check-out and making a match.
insert into scrim_signups (night_id, player_id, commitment, checked_in_at) values (9001, 1, 'definite', now());
select is((select last_active_at from scrim_nights where id = 9001), null, 'a check-in does not stamp the night');

update scrim_signups set checked_in_at = null where night_id = 9001 and player_id = 1;
select is((select last_active_at from scrim_nights where id = 9001), null, 'a check-out does not stamp the night');

do $$
begin
  perform queue_scrim_matches(9001, '[{"map": "foroglio", "workshop_id": "111", "shirts": [1, 2], "skins": [3, 4]}]'::jsonb);
end
$$;
select is((select last_active_at from scrim_nights where id = 9001), null, 'making a match does not stamp the night');

-- A match's server: only `provisioning` and `live` count, on insert or on a change of state.
insert into match_server_state (match_id, server_state)
select id, 'idle' from matches where scrim_night_id = 9001;
select is((select last_active_at from scrim_nights where id = 9001), null, 'an idle server does not stamp the night');

update match_server_state set server_state = 'provisioning' where match_id = (select id from matches where scrim_night_id = 9001);
select is((select last_active_at from scrim_nights where id = 9001), now(), 'a server going provisioning stamps the night');

update scrim_nights set last_active_at = null where id = 9001;
update match_server_state set server_state = 'live' where match_id = (select id from matches where scrim_night_id = 9001);
select is((select last_active_at from scrim_nights where id = 9001), now(), 'a server going live stamps the night');

delete from match_server_state where match_id = (select id from matches where scrim_night_id = 9001);
update scrim_nights set last_active_at = null where id = 9001;
insert into match_server_state (match_id, server_state)
select id, 'provisioning' from matches where scrim_night_id = 9001;
select is((select last_active_at from scrim_nights where id = 9001), now(), 'a server inserted as provisioning stamps the night');

update scrim_nights set last_active_at = null where id = 9001;
update match_server_state set server_state = 'tearing_down' where match_id = (select id from matches where scrim_night_id = 9001);
select is((select last_active_at from scrim_nights where id = 9001), null, 'a server tearing down does not stamp the night');

-- Scoring: a live round score (insert and update) and the final score.
update scrim_nights set last_active_at = null where id = 9001;
insert into live_match_score (match_id, shirts_score, skins_score, round)
select id, 1, 0, 1 from matches where scrim_night_id = 9001;
select is((select last_active_at from scrim_nights where id = 9001), now(), 'a live score insert stamps the night');

update scrim_nights set last_active_at = null where id = 9001;
update live_match_score set shirts_score = 2, round = 2 where match_id = (select id from matches where scrim_night_id = 9001);
select is((select last_active_at from scrim_nights where id = 9001), now(), 'a live score update stamps the night');

update scrim_nights set last_active_at = null where id = 9001;
update matches set final_score = '13-9' where scrim_night_id = 9001;
select is((select last_active_at from scrim_nights where id = 9001), now(), 'a final score stamps the night');

update scrim_nights set last_active_at = null where id = 9001;
update matches set final_score = '13-9' where scrim_night_id = 9001;
select is((select last_active_at from scrim_nights where id = 9001), null, 'rewriting the same final score does not stamp the night');

-- A night stamped within the last 5 minutes is left alone; an older stamp is refreshed.
update scrim_nights set last_active_at = now() - interval '2 minutes' where id = 9001;
update live_match_score set round = 3 where match_id = (select id from matches where scrim_night_id = 9001);
select is((select last_active_at from scrim_nights where id = 9001), now() - interval '2 minutes', 'activity within 5 minutes of the last stamp leaves it alone');

update scrim_nights set last_active_at = now() - interval '6 minutes' where id = 9001;
update live_match_score set round = 4 where match_id = (select id from matches where scrim_night_id = 9001);
select is((select last_active_at from scrim_nights where id = 9001), now(), 'activity over 5 minutes after the last stamp refreshes it');

-- An ended night is not revived by late activity.
update scrim_nights set ended_at = now() - interval '10 minutes', last_active_at = null where id = 9001;
update live_match_score set round = 5 where match_id = (select id from matches where scrim_night_id = 9001);
select is((select last_active_at from scrim_nights where id = 9001), null, 'a late live score does not revive an ended night');

update matches set final_score = '13-7' where scrim_night_id = 9001;
select is((select last_active_at from scrim_nights where id = 9001), null, 'a late final score does not revive an ended night');

update match_server_state set server_state = 'live' where match_id = (select id from matches where scrim_night_id = 9001);
select is((select last_active_at from scrim_nights where id = 9001), null, 'a late server start does not revive an ended night');

-- Nor is a night that went idle (never ended by hand, nothing active for over an hour).
update scrim_nights
set starts_at = now() - interval '5 hours', ended_at = null, last_active_at = now() - interval '3 hours'
where id = 9001;
update live_match_score set round = 6 where match_id = (select id from matches where scrim_night_id = 9001);
select is((select last_active_at from scrim_nights where id = 9001), now() - interval '3 hours', 'a late live score does not revive an idle night');

-- reopen_scrim_night() brings the night back, and activity counts on it again.
select lives_ok($$select reopen_scrim_night(9001)$$, 'an idle night is reopened');
select is((select last_active_at from scrim_nights where id = 9001), now(), 'reopening stamps the night');

update scrim_nights set last_active_at = now() - interval '10 minutes' where id = 9001;
update live_match_score set round = 7 where match_id = (select id from matches where scrim_night_id = 9001);
select is((select last_active_at from scrim_nights where id = 9001), now(), 'activity stamps a reopened night');

select * from finish();
rollback;
