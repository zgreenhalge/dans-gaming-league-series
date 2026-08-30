-- schedule_draft_locked_at superseded by lock_and_check_season_materialized()'s real Postgres row
-- lock (20260820160000_atomic_season_schedule_draft_rpcs.sql) — no application code reads or writes
-- it, and every row is null.

alter table public.seasons
  drop column schedule_draft_locked_at;
