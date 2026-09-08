// Polls Discord for scheduled events and writes any matching match's start time into
// `matches.scheduled_at` (#398) — see `syncSeasonScheduledEvents()` in `../src/lib/discord-event-sync.ts`
// for the correlation and idempotency rules. Runs against whichever regular season is currently
// `ACTIVE`, plus its paired gauntlet if one exists and is itself still going (a gauntlet season is
// born ACTIVE and stays that way until it's decided — see season-lifecycle.ts) — a no-op (not an
// error) when neither applies.
//
//   set -a; . ./.env.local; set +a
//   npx tsx scripts/discord-event-sync.ts

import { getActiveRegularSeason, getLinkedGauntlet } from '../src/lib/queries';
import { syncSeasonScheduledEvents, type SyncSeasonEventsResult } from '../src/lib/discord-event-sync';
import { getAdminClient } from '../src/lib/supabase-admin';

function report(result: SyncSeasonEventsResult | { error: string }): boolean {
  if ('error' in result) {
    console.error(`✖ ${result.error}`);
    return false;
  }
  for (const m of result.matches) {
    console.log(`  ${m.title}: ${m.status} — ${m.detail}`);
  }
  console.log(`Synced ${result.seasonName}: ${result.matches.length} unplayed match(es) checked.`);
  return true;
}

async function main() {
  const admin = getAdminClient();
  const season = await getActiveRegularSeason(admin);
  if (!season) {
    console.log('No ACTIVE regular season — nothing to sync.');
    return;
  }

  let ok = report(await syncSeasonScheduledEvents(admin, season.id));

  const gauntlet = await getLinkedGauntlet(season.name);
  if (gauntlet && gauntlet.status === 'ACTIVE') {
    ok = report(await syncSeasonScheduledEvents(admin, gauntlet.id)) && ok;
  }

  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
