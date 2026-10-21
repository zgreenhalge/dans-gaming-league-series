-- The `data_version` bump (20261021120000_add_data_version.sql) runs when a transaction commits, once
-- per transaction, rather than after each statement.
--
-- A bump inside a statement makes the writer hold the one `data_version` row's lock for the rest of
-- its transaction, after it has already locked content rows: two multi-statement transactions that
-- touch overlapping rows can then wait on each other and deadlock. A deferred constraint trigger
-- fires at commit, after every other lock has been taken, so the `data_version` lock is always the
-- last one acquired and held only for the commit itself — no cycle can include it. The bump is still
-- an UPDATE inside the writer's own transaction, so its new value becomes visible together with the
-- writer's data.
--
-- A constraint trigger fires per changed row, so the function skips every row after the first in a
-- transaction (a transaction-local flag): a bulk write bumps the version once, not once per row.
-- TRUNCATE can't be deferred; it keeps a statement-level trigger.
--
-- The function runs as its owner, so a write by any role bumps the version whatever that role may do
-- to `data_version` itself.

create or replace function public.bump_data_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if current_setting('app.data_version_bumped', true) = 'on' then
    return null;
  end if;
  perform set_config('app.data_version_bumped', 'on', true);
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
    execute format('drop trigger bump_data_version on public.%I', t.tablename);
    execute format(
      'create constraint trigger bump_data_version after insert or update or delete on public.%I '
      'deferrable initially deferred for each row execute function public.bump_data_version()',
      t.tablename
    );
    execute format(
      'create trigger bump_data_version_truncate after truncate on public.%I '
      'for each statement execute function public.bump_data_version()',
      t.tablename
    );
  end loop;
end
$$;
