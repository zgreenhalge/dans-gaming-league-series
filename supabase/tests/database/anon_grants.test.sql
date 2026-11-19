-- What the `anon` role can reach (supabase/migrations/20261008150000_enable_rls_revoke_anon.sql,
-- 20261009150000_narrow_realtime_anon_columns.sql and 20261111120000_realtime_page_refresh_tables.sql).
-- Run with `npx supabase test db` against the local stack (docs/e2e.md). Read-only catalog checks.
begin;
select plan(9);

-- Row level security is on for every table in `public`.
select is(
  (select coalesce(array_agg(relname::text order by relname), array[]::text[])
   from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity),
  array[]::text[], 'every public table has row level security');

-- `anon` selects only the columns each Realtime subscription reads (primary key, filter column, and what
-- the component displays).
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'match_server_state'
     and has_column_privilege('anon', 'public.match_server_state', column_name, 'select')),
  array['match_id', 'server_state'], 'anon reads only match_id and server_state of match_server_state');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'background_jobs'
     and has_column_privilege('anon', 'public.background_jobs', column_name, 'select')),
  array['id', 'job_type', 'match_id', 'status'], 'anon reads only id, job_type, match_id and status of background_jobs');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'scrim_signups'
     and has_column_privilege('anon', 'public.scrim_signups', column_name, 'select')),
  array['id', 'night_id'], 'anon reads only id and night_id of scrim_signups');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'scrim_nights'
     and has_column_privilege('anon', 'public.scrim_nights', column_name, 'select')),
  array['id'], 'anon reads only id of scrim_nights');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'gauntlet_pods'
     and has_column_privilege('anon', 'public.gauntlet_pods', column_name, 'select')),
  array['id', 'season_id'], 'anon reads only id and season_id of gauntlet_pods');

-- `anon` writes nothing.
select is(
  (select coalesce(array_agg(c.relname::text || ' ' || p.priv order by c.relname, p.priv), array[]::text[])
   from pg_class c, (values ('insert'), ('update'), ('delete'), ('truncate')) as p(priv)
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege('anon', c.oid, p.priv)),
  array[]::text[], 'anon has no write privilege on any public table');

-- `anon` executes no function in `public`, the scrim and season RPCs included.
select is(
  (select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), array[]::text[])
   from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')),
  array[]::text[], 'anon can execute no public function');
select cmp_ok(
  (select count(*)::int from pg_proc where proname in (
    'update_scrim_match', 'discard_scrim_match', 'claim_scrim_match_start', 'reopen_scrim_night',
    'start_scrim_night', 'delete_upcoming_season')),
  '=', 6, 'the functions the grant check covers exist');

select * from finish();
rollback;
