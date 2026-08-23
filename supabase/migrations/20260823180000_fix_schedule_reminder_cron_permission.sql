-- schedule_match_reminder() calls cron.schedule()/cron.unschedule(), but the cron schema only
-- grants usage to postgres/supabase_admin. Without `security definer` the function runs as its
-- caller's role (service_role or authenticated, via PostgREST's role-switching) rather than as its
-- owner (postgres), so every call fails with "permission denied for schema cron". Marking it
-- security definer runs it as its owning role instead, which does have cron schema access.
--
-- search_path is locked to empty rather than left to inherit the caller's, per Postgres's own
-- guidance for security definer functions (a mutable search_path lets a caller shadow an unqualified
-- reference with an object of their own). Safe here because the function body already fully
-- qualifies every cross-schema reference (cron.*, vault.*, net.*, public.*).
alter function public.schedule_match_reminder(integer, timestamptz)
  security definer
  set search_path = '';
