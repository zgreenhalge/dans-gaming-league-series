-- The scrim night page (`/scrims/[id]`) refreshes itself on Realtime `postgres_changes` to
-- `scrim_signups` (signups, check-ins, drop-outs) and `scrim_nights` (End night), through
-- `RefreshOnServerState`. Realtime streams only tables in the `supabase_realtime` publication, and
-- delivers an event only when the subscriber's role may select the row's primary key and every
-- filter column. The page reads nothing from the event itself, so `anon` gets just those columns:
--
--   scrim_signups  `id` (primary key) and `night_id` (the filter)
--   scrim_nights   `id` (primary key and the filter)

do $$
declare
  t text;
begin
  foreach t in array array['scrim_signups', 'scrim_nights'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

grant select (id, night_id) on public.scrim_signups to anon;
create policy "anon reads scrim_signups for Realtime" on public.scrim_signups
  for select to anon using (true);

grant select (id) on public.scrim_nights to anon;
create policy "anon reads scrim_nights for Realtime" on public.scrim_nights
  for select to anon using (true);
