-- Every `public` function runs with a fixed `search_path`, so a caller's session setting cannot
-- redirect the unqualified table, type and function names in its body. These bodies refer to
-- `public` objects unqualified, so `public` is the path; `pg_catalog` is always searched first.

alter function public.enforce_season_players_upcoming() set search_path = public;
alter function public.reconcile_gauntlet_draft(integer[], jsonb, jsonb, integer[], jsonb) set search_path = public;
alter function public.lock_and_check_season_materialized(integer) set search_path = public;
alter function public.clear_season_schedule_draft(integer) set search_path = public;
alter function public.generate_season_schedule_draft(integer, jsonb) set search_path = public;
alter function public.save_season_schedule_draft(integer, jsonb) set search_path = public;
alter function public.delete_season_schedule_draft(integer) set search_path = public;
alter function public.confirm_season_schedule_draft(integer, jsonb) set search_path = public;
alter function public.rollback_season_schedule_draft(integer) set search_path = public;

-- `confirm_season_schedule_draft(integer)` is an unused single-argument overload: the app calls
-- the `(integer, jsonb)` form (`confirmSeasonScheduleDraft()` in
-- `src/lib/season-schedule-draft-engine.ts`), and no other migration defines it.
drop function if exists public.confirm_season_schedule_draft(integer);
