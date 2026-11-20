-- What the `anon` role can reach: RLS, Realtime column grants, writes and functions.
-- Run with `npx supabase test db` against the local stack (docs/e2e.md). Read-only catalog checks.
begin;
select plan(4);

-- Row level security is on for every table in `public`.
select is(
  (select coalesce(array_agg(relname::text order by relname), array[]::text[])
   from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity),
  array[]::text[], 'every public table has row level security');

-- `anon` selects only the columns each Realtime subscription reads (primary key, filter column, and what
-- the component displays).
select is(
  (select array_agg(t.tbl || ': ' || t.cols order by t.tbl)
   from (
     select c.table_name::text as tbl, string_agg(c.column_name::text, ', ' order by c.column_name) as cols
     from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name in ('match_server_state', 'background_jobs', 'scrim_signups', 'scrim_nights', 'gauntlet_pods')
       and has_column_privilege('anon', format('public.%I', c.table_name), c.column_name, 'select')
     group by c.table_name) t),
  array[
    'background_jobs: id, job_type, match_id, status',
    'gauntlet_pods: id, season_id',
    'match_server_state: match_id, server_state',
    'scrim_nights: id',
    'scrim_signups: id, night_id'],
  'anon reads only the Realtime columns of the five tables it subscribes to');

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

select * from finish();
rollback;
