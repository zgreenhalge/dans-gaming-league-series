// Runs the structural parse invariants (`checkStructuralInvariants()`, `src/lib/parsers/demoInvariants.ts`)
// over demos already stored in R2 and prints every violation per match. Read-only: it parses and
// reports, and writes nothing to R2, the database, or any job row.
//
// A match's demo is read straight from R2 — its manifest's segments when it has one, otherwise
// `demoKey(matchId)` — through the same `parseDemoBuffers()` entry point `scripts/demo-ingest.ts` uses,
// with the match's stored roster/side/target from `getReplayInputs()`. A match with no demo in R2 is
// skipped.
//
// Needs CLOUDFLARE_R2_* plus NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
//
// Usage:  npm run demo-invariants:check [-- <matchId> ...]
// With no match ids, checks every match that has a demo in R2. Exits 1 if any match has a violation or
// fails to parse.

import { getAdminClient } from '../src/lib/supabase-admin';
import { getReplayInputs } from '../src/lib/replay/inputs';
import { parseDemoBuffers } from '../src/lib/demo/parseDemo';
import { getDemoManifest } from '../src/lib/demo/segmentManifest';
import { demoKey, getR2Object, listDemoMatchIds } from '../src/lib/r2';
import { gunzipMaybe } from '../src/lib/gzip';
import { checkStructuralInvariants } from '../src/lib/parsers/demoInvariants';

async function loadDemoBuffers(matchId: number): Promise<Buffer[] | null> {
  const manifest = await getDemoManifest(matchId);
  const keys = manifest ? manifest.segments : [demoKey(matchId)];
  const buffers = await Promise.all(keys.map((k) => getR2Object(k)));
  return buffers.every((b): b is Buffer => b !== null) ? buffers : null;
}

async function main() {
  const supabase = getAdminClient();
  const requested = process.argv.slice(2).map(Number);
  if (requested.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error(`Bad match id in: ${process.argv.slice(2).join(' ')}`);
  const matchIds = requested.length > 0 ? requested : await listDemoMatchIds();

  let violated = 0;
  let failed = 0;
  let skipped = 0;
  for (const matchId of matchIds) {
    try {
      const buffers = await loadDemoBuffers(matchId);
      if (!buffers) {
        skipped++;
        console.log(`match ${matchId}: no demo in R2, skipped`);
        continue;
      }
      const { roster, skinsSide, targetWinRounds } = await getReplayInputs(supabase, matchId);
      const { parsed, sab } = parseDemoBuffers(buffers.map(gunzipMaybe), roster, skinsSide, targetWinRounds);
      const violations = checkStructuralInvariants(parsed, sab);
      if (violations.length === 0) {
        console.log(`match ${matchId}: ok`);
      } else {
        violated++;
        console.log(`match ${matchId}: ${violations.length} violation(s)`);
        for (const v of violations) console.log(`  - ${v}`);
      }
    } catch (e) {
      failed++;
      console.log(`match ${matchId}: failed to parse — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(
    `\n${matchIds.length} match(es): ${matchIds.length - violated - failed - skipped} ok, ` +
      `${violated} with violations, ${failed} failed to parse, ${skipped} skipped`,
  );
  if (violated > 0 || failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
