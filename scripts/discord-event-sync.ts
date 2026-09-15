// Polls Discord for scheduled events and writes any matching match's start time into
// `matches.scheduled_at` (#398) — see `syncSeasonScheduledEvents()` in `../src/lib/discord-event-sync.ts`
// for the correlation and idempotency rules. Runs against every currently `ACTIVE` season, regular or
// gauntlet — a no-op (not an error) when none are.
//
//   set -a; . ./.env.local; set +a
//   npx tsx scripts/discord-event-sync.ts

import { getSeasons } from '../src/lib/queries';
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
  const activeSeasons = (await getSeasons(admin)).filter((s) => s.status === 'ACTIVE');
  if (activeSeasons.length === 0) {
    console.log('No ACTIVE seasons — nothing to sync.');
    return;
  }

  let ok = true;
  for (const season of activeSeasons) {
    ok = report(await syncSeasonScheduledEvents(admin, season.id)) && ok;
  }

  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
