-- reopen_scrim_night() (supabase/migrations/20261115120000_reopen_scrim_night_coded_refusal.sql).
-- Run with `npx supabase test db` against the local stack (docs/e2e.md). Everything happens inside
-- one transaction that rolls back, so the stack's data is untouched.
begin;
select plan(9);

-- Fixtures: any night already on the local stack is cleared first, inside the transaction.
--   9001 started 2 hours ago, ended by hand an hour ago  (the night under test)
--   9002 started 2 hours ago, active 10 minutes ago      (current: holds the server)
delete from scrim_nights;
insert into scrim_nights (id, starts_at, ended_at, last_active_at) values
  (9001, now() - interval '2 hours', now() - interval '1 hour', null),
  (9002, now() - interval '2 hours', null, now() - interval '10 minutes');

-- Refusal: another night holds the server.
select throws_ok($$select reopen_scrim_night(9001)$$, 'P0001', 'current-scrim-night', 'another current night refuses the reopen');
select is((select ended_at is not null from scrim_nights where id = 9001), true, 'a refused reopen leaves the night ended');

-- Success: with 9002 over, 9001 reopens: ended_at clears and it counts as active now.
update scrim_nights set ended_at = now() - interval '5 minutes' where id = 9002;
select lives_ok($$select reopen_scrim_night(9001)$$, 'an ended night is reopened');
select is(
  (select ended_at is null and last_active_at > now() - interval '1 minute' from scrim_nights where id = 9001),
  true, 'reopening clears ended_at and stamps last_active_at');

-- Refusal: a night that is already open (a concurrent reopen got there) or gone.
select throws_ok($$select reopen_scrim_night(9001)$$, 'P0001', 'scrim-night-not-over', 'a night that is already open is refused');
select is((select ended_at is null from scrim_nights where id = 9001), true, 'a refused reopen changes nothing');
delete from scrim_nights;
select throws_ok($$select reopen_scrim_night(9001)$$, 'P0001', 'scrim-night-not-over', 'a missing night is refused');

-- A night gone idle (never ended by hand, nothing active for over an hour) is over too.
delete from scrim_nights;
insert into scrim_nights (id, starts_at, ended_at, last_active_at) values (9004, now() - interval '5 hours', null, now() - interval '3 hours');
select lives_ok($$select reopen_scrim_night(9004)$$, 'an idle night is reopened');
select is((select last_active_at > now() - interval '1 minute' from scrim_nights where id = 9004), true, 'reopening an idle night stamps last_active_at');

select * from finish();
rollback;
