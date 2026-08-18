// Polls Discord for scheduled events and writes any matching match's start time into
// `matches.scheduled_at` (#398) — see `syncSeasonScheduledEvents()` in `../src/lib/discord-event-sync.ts`
// for the correlation and idempotency rules. Runs against whichever regular season is currently
// `ACTIVE`; a no-op (not an error) when none is.
//
//   set -a; . ./.env.local; set +a
//   npx tsx scripts/discord-event-sync.ts

import { getActiveRegularSeason } from '../src/lib/queries';
import { syncSeasonScheduledEvents } from '../src/lib/discord-event-sync';
import { getAdminClient } from '../src/lib/supabase-admin';

async function main() {
  const admin = getAdminClient();
  const season = await getActiveRegularSeason(admin);
  if (!season) {
    console.log('No ACTIVE regular season — nothing to sync.');
    return;
  }

  const result = await syncSeasonScheduledEvents(admin, season.id);
  if ('error' in result) {
    console.error(`✖ ${result.error}`);
    process.exit(1);
  }

  for (const m of result.matches) {
    console.log(`  ${m.title}: ${m.status} — ${m.detail}`);
  }
  console.log(`Synced ${result.seasonName}: ${result.matches.length} unplayed match(es) checked.`);
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
