// Warns players on the shared DatHost server, via an in-game `say`, when a scheduled league match is
// getting close while a scrim is still occupying it. A scrim never blocks a match from starting (the
// server just gets reconfigured out from under it once the match is provisioned), so this is purely a
// heads-up to wrap up voluntarily — nothing here stops or kicks anyone.
//
// No-ops immediately unless a `scrim_sessions` row is active (see `src/lib/scrim-session.ts`) — most
// runs do nothing. Each of the three thresholds (15/10/5 minutes until the nearest unscored league
// match's `scheduled_at`) fires at most once per scrim, tracked via the session row's `warned_*`
// columns, and only the single most urgent unsent threshold fires per run — so a run that lands inside
// the 5-minute band skips straight to that message rather than replaying 15/10 after the fact.
//
//   set -a; . ./.env.local; set +a
//   npx tsx scripts/scrim-warnings.ts
//
// Env: DATHOST_EMAIL, DATHOST_PASSWORD, DATHOST_SERVER_ID (or pass a server id as argv[2]),
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Intended to run on a GitHub Actions cron (`.github/workflows/scrim-warnings.yml`), not a Vercel
// cron — this project's Vercel plan only supports daily crons, far too coarse for a 5-minute check.

import { getServer, runConsole } from '../src/lib/dathost';
import { getAdminClient } from '../src/lib/supabase-admin';
import { findNearbyUnscoredMatch } from '../src/lib/dathost-lifecycle';
import { reconcileScrimSession, markScrimWarned, isScrimWarned, type ScrimSession } from '../src/lib/scrim-session';
import { notice, error } from './gh-actions-log';

const THRESHOLDS = [5, 10, 15] as const;

function warningSayCommand(minutesUntil: number): string {
  const label = minutesUntil <= 1 ? 'starting now' : `starting in about ${Math.round(minutesUntil)} minutes`;
  return `say A league match is ${label} — please wrap up this scrim.`;
}

/** The single most urgent threshold that's due (band reached) and hasn't fired yet, or `null`. */
function dueThreshold(minutesUntil: number, session: ScrimSession): 15 | 10 | 5 | null {
  for (const threshold of THRESHOLDS) {
    if (minutesUntil > threshold) continue;
    if (!isScrimWarned(session, threshold)) return threshold;
  }
  return null;
}

async function main() {
  const serverId = process.argv[2] || process.env.DATHOST_SERVER_ID;
  if (!serverId) throw new Error('Set DATHOST_SERVER_ID or pass a server id as an argument.');

  const supabase = getAdminClient();
  const server = await getServer(serverId).catch(() => null);
  const session = await reconcileScrimSession(supabase, server);
  if (!session) {
    notice('no active scrim — nothing to do');
    return;
  }

  const nearby = await findNearbyUnscoredMatch(supabase);
  if (!nearby) {
    notice('scrim is active, but no nearby unscored league match — nothing to do');
    return;
  }

  const minutesUntil = (new Date(nearby.scheduledAt).getTime() - Date.now()) / 60_000;
  const threshold = dueThreshold(minutesUntil, session);
  if (threshold === null) {
    notice(`scrim is active; ${nearby.label} is ${minutesUntil.toFixed(1)}min away — no new threshold due`);
    return;
  }

  await runConsole(serverId, warningSayCommand(minutesUntil));
  await markScrimWarned(supabase, threshold);
  notice(`sent the ${threshold}-minute warning for ${nearby.label} (${minutesUntil.toFixed(1)}min away)`);
}

main().catch((err) => {
  error(`scrim-warnings failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
