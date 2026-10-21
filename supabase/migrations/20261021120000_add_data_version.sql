-- `data_version` is the freshness signal behind the persistent read cache (`persistentQuery()` in
-- src/lib/queries/_persistentCache.ts): one row whose `version` goes up on every content write. A cached read
-- is keyed by the version it was computed at, so any write — from the app, a GitHub Action, an
-- ingestion script or hand-run SQL — retires every cached read at once, with no writer having to know
-- the cache exists.
--
-- The bump is a row UPDATE inside the writer's own transaction, not a sequence: the new version
-- becomes visible to other sessions only when the write commits, so a reader that sees version N
-- always sees the data of every write up to N. (A sequence advances outside the transaction and
-- would let a reader cache pre-commit data under the new version.)
--
-- Every `public` table fires the bump except the operational tables listed in the DO block below,
-- whose rows no cached read depends on. `src/lib/migrations-data-version.test.ts` fails CI on a
-- migration that creates a `public` table without wiring one or the other.

create table public.data_version (
  id smallint primary key default 1 check (id = 1),
  version bigint not null default 1
);
alter table public.data_version enable row level security;
insert into public.data_version (id) values (1);

create function public.bump_data_version()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  update public.data_version set version = version + 1 where id = 1;
  return null;
end;
$function$;

do $$
declare
  t record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename not in (
        'data_version',
        'background_jobs',
        'config_set_files',
        'config_sets',
        'live_match_score',
        'match_discord_state',
        'match_server_state',
        'ops_errors',
        'scrim_sessions'
      )
  loop
    execute format(
      'create trigger bump_data_version after insert or update or delete or truncate on public.%I '
      'for each statement execute function public.bump_data_version()',
      t.tablename
    );
  end loop;
end
$$;
