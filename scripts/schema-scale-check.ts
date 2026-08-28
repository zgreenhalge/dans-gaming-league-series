// Warns when a career-wide, fact-table-backed query's row count crosses the scale threshold
// established by #487's local-Postgres benchmark, so a "query-time aggregation is fine at this
// league's scale" assumption gets re-checked by a real number instead of by someone noticing the
// site got slow.
//
// Candidates are every table a "get everything, all seasons" query reads in full via
// `fetchAllPages()` — the trait that makes a query's cost grow with total league history rather
// than staying flat regardless of league size (a single-match or single-season query never grows).
// The benchmark found raw Postgres execution stays well under 100ms even at 100x this league's
// current volume (8,700 matches, ~400k match_kills rows) — the real cost driver at scale is round
// trips: `fetchAllPages()` fetches `SUPABASE_PAGE_SIZE` (1,000) rows per PostgREST request, so a
// table crossing THRESHOLD rows needs 50+ sequential round trips for one full read. See
// docs/architecture.md's "Surfacing best-effort failures" section for how this feeds `ops_errors`,
// and the #487 PR description for the full benchmark writeup.
//
//   set -a; . ./.env.local; set +a
//   npx tsx scripts/schema-scale-check.ts
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Runs on a GitHub Actions cron (`.github/workflows/schema-scale-check.yml`), not a Vercel cron —
// same reasoning as scrim-warnings.ts, though this one only needs to run weekly/monthly.

import { getAdminClient } from '../src/lib/supabase-admin';
import { recordOpsError, clearOpsError } from '../src/lib/ops-errors';
import { notice, warning, error as logError } from './gh-actions-log';

const THRESHOLD = 50_000;

const HEAVY_TABLES = [
  'match_kills',
  'match_rounds',
  'match_utility_throws',
  'player_match_stats',
  'player_match_sabremetrics',
  'player_match_weapon_stats',
  'player_match_economy_stats',
  'player_rating_history',
  'player_season_leaderboard',
] as const;

async function main() {
  const supabase = getAdminClient();
  let anyOverThreshold = false;

  for (const table of HEAVY_TABLES) {
    // `table` spans both real tables and the `player_season_leaderboard` view, so (like
    // `batchedIn()` in `queries/_shared.ts`) it can't be narrowed to the generated client's
    // per-relation literal union.
    const { count, error } = await supabase.from(table as never).select('*', { count: 'exact', head: true });
    if (error) throw error;
    const rowCount = count ?? 0;
    const operation = `schema_scale_${table}`;

    if (rowCount >= THRESHOLD) {
      anyOverThreshold = true;
      const pages = Math.ceil(rowCount / 1000);
      const message =
        `${table} has ${rowCount} rows (>= ${THRESHOLD}) — a full career-wide read now needs `
        + `~${pages} sequential fetchAllPages() round trips. Reassess the query-time-aggregation `
        + 'approach for this table (#487).';
      warning(message);
      await recordOpsError(supabase, 'system', 0, operation, message);
    } else {
      await clearOpsError(supabase, 'system', 0, operation);
      notice(`${table}: ${rowCount} rows (threshold ${THRESHOLD})`);
    }
  }

  if (!anyOverThreshold) notice('schema-scale-check: every heavy table is under threshold');
}

main().catch((err) => {
  logError(`schema-scale-check failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
