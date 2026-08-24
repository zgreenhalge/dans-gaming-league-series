-- `schedule_match_reminder()`'s own comment (see `20260818020000_fix_schedule_reminder_bugs.sql`)
-- describes it as running with the privileges needed to call `cron.schedule`/`cron.unschedule` —
-- but its `create or replace function` never actually declared `security definer`, so it ran as
-- whatever role invoked the RPC (the app's service-role client), which has no `usage` on the `cron`
-- schema. This marks it `security definer` for real, pinned to the definer's privileges rather than
-- the caller's, and pairs that with `set search_path = ''` (all of the function's schema references
-- are already fully qualified) so a security-definer function can't be tricked into resolving an
-- unqualified name against a search path the caller controls.
alter function public.schedule_match_reminder(integer, timestamptz)
  security definer
  set search_path = '';
