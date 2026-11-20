-- Scrim night activity triggers (supabase/migrations/20261110120000_scrim_night_idle_end.sql).
-- Run with `npx supabase test db` against the local stack (docs/e2e.md). Everything happens inside
-- one transaction that rolls back, so the stack's data is untouched.
begin;
select plan(16);

-- Fixtures: any night already on the local stack is cleared first, inside the transaction.
--   9001 started 30 minutes ago, never stamped  (the active night under test; `last_active_at` is reset
--                                                to null between cases)
--   9002 started 3 hours ago, ended by hand     (an ended night that late activity must not revive)
-- Players 1-2 come from supabase/seed.sql.
delete from scrim_nights;
insert into scrim_nights (id, starts_at, ended_at, last_active_at) values
  (9001, now() - interval '30 minutes', null, null),
  (9002, now() - interval '3 hours', now() - interval '2 hours', null);
insert into matches (id, match_number, scrim_night_id, scrim_side_choice) values (9001, 1, 9001, 'random'), (9002, 1, 9002, 'random');

-- Not activity: signing up, checking in, checking out and making a match.
insert into scrim_signups (id, night_id, player_id, commitment) values (9001, 9001, 1, 'definite');
select ok((select last_active_at is null from scrim_nights where id = 9001), 'signing up is not activity');
update scrim_signups set checked_in_at = now() where id = 9001;
select ok((select last_active_at is null from scrim_nights where id = 9001), 'checking in is not activity');
update scrim_signups set checked_in_at = null where id = 9001;
select ok((select last_active_at is null from scrim_nights where id = 9001), 'checking out is not activity');
insert into matches (id, match_number, scrim_night_id, scrim_side_choice) values (9003, 2, 9001, 'random');
select ok((select last_active_at is null from scrim_nights where id = 9001), 'making a match is not activity');

-- Not activity: a server state other than provisioning / live.
insert into match_server_state (match_id, server_state) values (9001, 'idle');
select ok((select last_active_at is null from scrim_nights where id = 9001), 'an idle server is not activity');
update match_server_state set server_state = 'failed' where match_id = 9001;
select ok((select last_active_at is null from scrim_nights where id = 9001), 'a failed server is not activity');

-- Activity: the server going provisioning, then live; each stamps the night.
update match_server_state set server_state = 'provisioning' where match_id = 9001;
select ok((select last_active_at > now() - interval '1 minute' from scrim_nights where id = 9001), 'a server going provisioning stamps the night');
update scrim_nights set last_active_at = null where id = 9001;
update match_server_state set server_state = 'live' where match_id = 9001;
select ok((select last_active_at > now() - interval '1 minute' from scrim_nights where id = 9001), 'a server going live stamps the night');
update scrim_nights set last_active_at = null where id = 9001;
insert into match_server_state (match_id, server_state) values (9003, 'provisioning');
select ok((select last_active_at > now() - interval '1 minute' from scrim_nights where id = 9001), 'a server row inserted as provisioning stamps the night');

-- Activity: a live round score and the final score.
update scrim_nights set last_active_at = null where id = 9001;
insert into live_match_score (match_id, round, shirts_score, skins_score) values (9001, 1, 1, 0);
select ok((select last_active_at > now() - interval '1 minute' from scrim_nights where id = 9001), 'a live score stamps the night');
update scrim_nights set last_active_at = null where id = 9001;
update matches set final_score = '13-9' where id = 9001;
select ok((select last_active_at > now() - interval '1 minute' from scrim_nights where id = 9001), 'a final score stamps the night');

-- A night stamped within the last 5 minutes is left alone.
update scrim_nights set last_active_at = now() - interval '2 minutes' where id = 9001;
update live_match_score set shirts_score = 2 where match_id = 9001;
select ok((select last_active_at between now() - interval '3 minutes' and now() - interval '1 minute' from scrim_nights where id = 9001), 'a night stamped 2 minutes ago is not restamped');
update scrim_nights set last_active_at = now() - interval '10 minutes' where id = 9001;
update live_match_score set shirts_score = 3 where match_id = 9001;
select ok((select last_active_at > now() - interval '1 minute' from scrim_nights where id = 9001), 'a night stamped 10 minutes ago is restamped');

-- An ended night is not revived by late activity.
insert into live_match_score (match_id, round, shirts_score, skins_score) values (9002, 1, 1, 0);
update matches set final_score = '13-5' where id = 9002;
insert into match_server_state (match_id, server_state) values (9002, 'live');
select ok((select last_active_at is null from scrim_nights where id = 9002), 'late activity does not stamp an ended night');
select ok((select ended_at is not null from scrim_nights where id = 9002), 'late activity does not reopen an ended night');

-- An idle night (nothing for over an hour) is over, so activity on it does not revive it either.
update scrim_nights set starts_at = now() - interval '5 hours', last_active_at = now() - interval '3 hours' where id = 9001;
update live_match_score set shirts_score = 4 where match_id = 9001;
select ok((select last_active_at < now() - interval '2 hours' from scrim_nights where id = 9001), 'activity does not revive an idle night');

select * from finish();
rollback;
