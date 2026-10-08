-- Access model: every `public` table has row level security on, and only the server-side
-- service-role client reads or writes them (it bypasses RLS). `anon` and `authenticated` hold no
-- privileges on tables, sequences or functions, with one exception: `anon` may `select` the tables
-- the browser's Realtime `postgres_changes` subscriptions watch (`src/lib/supabase-browser.ts`
-- callers), each through an explicit `for select` policy. Realtime delivers a change only to
-- subscribers who can select the row, so that grant + policy pair is what keeps those
-- subscriptions working.
--
-- Adding a Realtime subscription to another table means adding it to the `supabase_realtime`
-- publication and giving it the same grant + policy pair below. The default-privilege revokes keep
-- `anon`/`authenticated`/`public` off tables, sequences and functions this role creates later; a new
-- table still needs its own `enable row level security`.

-- ─── RLS on, no policies by default ────────────────────────────────────────────

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end
$$;

-- ─── No client-role privileges ──────────────────────────────────────────────────

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Future objects start closed too. Functions are executable by `public` unless revoked globally
-- for the role that creates them.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

-- ─── Realtime subscriptions: anon may read the subscribed tables ───────────────

grant select on public.live_match_score to anon;
create policy "anon reads live_match_score for Realtime" on public.live_match_score
  for select to anon using (true);

grant select on public.matches to anon;
create policy "anon reads matches for Realtime" on public.matches
  for select to anon using (true);

grant select on public.match_server_state to anon;
create policy "anon reads match_server_state for Realtime" on public.match_server_state
  for select to anon using (true);

grant select on public.background_jobs to anon;
create policy "anon reads background_jobs for Realtime" on public.background_jobs
  for select to anon using (true);
