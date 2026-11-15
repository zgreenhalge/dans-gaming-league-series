-- What `anon` and `authenticated` may reach in `public`
-- (supabase/migrations/20261008150000_enable_rls_revoke_anon.sql,
-- 20261009150000_narrow_realtime_anon_columns.sql and 20261111120000_realtime_page_refresh_tables.sql).
-- `anon` holds `select` on the tables and columns the browser's Realtime subscriptions watch and
-- nothing else; the API roles execute no function; every table has row level security on.
-- Run with `npx supabase test db` against the local stack (docs/e2e.md). The file only reads the
-- catalog, so it changes nothing.
begin;
select plan(8);

-- Realtime reads whole rows of `live_match_score` and `matches`, and only the listed columns of the
-- rest. A table added to this list is a table the public API can read.
select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_any_column_privilege('anon', c.oid, 'select')),
  array['background_jobs', 'gauntlet_pods', 'live_match_score', 'match_server_state', 'matches', 'scrim_nights', 'scrim_signups'],
  'anon can read only the Realtime tables');

select is(
  (select array_agg(c.relname || '.' || a.attname order by c.relname, a.attnum)
   from pg_attribute a
   join pg_class c on c.oid = a.attrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('background_jobs', 'gauntlet_pods', 'match_server_state', 'scrim_nights', 'scrim_signups')
     and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('anon', c.oid, a.attnum, 'select')),
  array[
    'background_jobs.id', 'background_jobs.job_type', 'background_jobs.match_id', 'background_jobs.status',
    'gauntlet_pods.id', 'gauntlet_pods.season_id',
    'match_server_state.match_id', 'match_server_state.server_state',
    'scrim_nights.id',
    'scrim_signups.id', 'scrim_signups.night_id'
  ],
  'anon can read only the Realtime columns of the narrowed tables');

-- `anon` never writes, and the API roles reach no other table.
select is(
  (select string_agg(c.relname::text, ', ' order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_any_column_privilege('anon', c.oid, 'insert')
       or has_any_column_privilege('anon', c.oid, 'update')
       or has_any_column_privilege('anon', c.oid, 'references')
       or has_table_privilege('anon', c.oid, 'delete')
       or has_table_privilege('anon', c.oid, 'truncate')
       or has_table_privilege('anon', c.oid, 'trigger'))),
  null, 'anon can write no table');

select is(
  (select string_agg(c.relname::text, ', ' order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_any_column_privilege('authenticated', c.oid, 'select, insert, update, references')),
  null, 'authenticated can reach no table');

-- Every function in `public` (the RPCs, the triggers' functions, the helpers) is for `service_role`
-- alone. Extension members are left out: they belong to their extension, not to the migrations.
select is(
  (select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'execute')),
  null, 'anon can execute no function');

select is(
  (select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('authenticated', p.oid, 'execute')),
  null, 'authenticated can execute no function');

select is(
  (select string_agg(c.relname::text, ', ' order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S'
     and (has_sequence_privilege('anon', c.oid, 'usage, select, update')
       or has_sequence_privilege('authenticated', c.oid, 'usage, select, update'))),
  null, 'the API roles can use no sequence');

select is(
  (select string_agg(c.relname::text, ', ' order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  null, 'every table has row level security on');

select * from finish();
rollback;
