-- `anon` reads `match_server_state` and `background_jobs` only so the browser's Realtime
-- `postgres_changes` subscriptions on them deliver events. Realtime builds each event payload from
-- the columns the subscriber's role may select, and requires the primary key and every filter
-- column to be selectable, so a column-level grant both keeps those subscriptions working and
-- keeps everything else in the rows off the public API:
--
--   match_server_state  `MatchServerPanel` filters on `match_id` and reads `server_state`; it
--                       fetches the connect string from the access-checked
--                       `/api/matches/[id]/server/status` route.
--   background_jobs     `MatchDemoReviewBlock` filters on `match_id` and reads `job_type` and
--                       `status`; `id` is the primary key.
--
-- Revoking the table-level privilege also drops any column privileges, so the revoke comes first.
-- The existing `for select to anon using (true)` policies stay in place.

revoke select on public.match_server_state from anon;
grant select (match_id, server_state) on public.match_server_state to anon;

revoke select on public.background_jobs from anon;
grant select (id, job_type, match_id, status) on public.background_jobs to anon;
