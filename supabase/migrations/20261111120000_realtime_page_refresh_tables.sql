-- Server pages that refresh themselves on Realtime `postgres_changes` through
-- `RefreshOnServerState`: the scrim night page (`/scrims/[id]`) on `scrim_signups` (signups,
-- check-ins, drop-outs) and `scrim_nights` (End night), and the gauntlet round and group pages on
-- `gauntlet_pods` (a group scheduled into a round's new week). Realtime streams only tables in the
-- `supabase_realtime` publication, and delivers an event only when the subscriber's role may
-- select the row's primary key and every filter column. The pages read nothing from the event
-- itself, so `anon` gets just those columns:
--
--   scrim_signups  `id` (primary key) and `night_id` (the filter)
--   scrim_nights   `id` (primary key and the filter)
--   gauntlet_pods  `id` (primary key) and `season_id` (the filter)

do $$
declare
  t text;
begin
  foreach t in array array['scrim_signups', 'scrim_nights', 'gauntlet_pods'] loop
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

grant select (id, season_id) on public.gauntlet_pods to anon;
create policy "anon reads gauntlet_pods for Realtime" on public.gauntlet_pods
  for select to anon using (true);
