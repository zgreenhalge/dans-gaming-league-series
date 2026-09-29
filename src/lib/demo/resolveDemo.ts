// Resolves a match's demo buffer(s) — shared by the two Action scripts that need this before they can
// start parsing (`scripts/demo-ingest.ts`, `scripts/replay-extract.ts`). A manifest means the demo
// arrived as a manual multi-segment upload (a server restart mid-match split it into more than one
// recording — see docs/demo-ingestion.md's "Multi-segment demos"); its segments are already in R2 and
// read straight from there, never through `pullDemoAndClearLiveScore` — the single-file key that pulls/
// caches doesn't exist for a multi-segment match, and a miss there would otherwise try (and fail, or
// grab the wrong file) to pull fresh from DatHost. Otherwise, this pulls the single-file demo from
// DatHost if it isn't already in R2 (a manual upload or a reparse of an already-staged/confirmed match
// has it already).
//
// Every segment landing in R2 is equally proof the match is over, so a manifest resolution clears
// `live_match_score` itself, the same "presence in R2 ends 'live'" rule `pullDemoAndClearLiveScore`
// already applies to the single-file case.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DemoSegmentManifest } from './segmentManifest';
import { getR2Object } from '../r2';
import { pullDemoAndClearLiveScore, clearLiveScoreBestEffort } from './liveScore';
import { dathostServerId } from '../dathost';

/** `manifest` is resolved by the caller (often concurrently with other per-match reads that don't
 *  depend on it, e.g. `getReplayInputs()`) rather than fetched again in here. */
export async function resolveDemoBuffers(
  admin: SupabaseClient,
  matchId: number,
  manifest: DemoSegmentManifest | null,
  baseName: string,
  opts: { shouldWaitForConcurrentPull?: () => Promise<boolean>; getFlushFloorMs?: () => Promise<number> } = {},
): Promise<Buffer[]> {
  if (manifest) {
    const buffers = await Promise.all(manifest.segments.map(async (key) => {
      const buf = await getR2Object(key);
      if (!buf) throw new Error(`Demo segment not found (${key}) — the upload may be incomplete.`);
      return buf;
    }));
    await clearLiveScoreBestEffort(admin, matchId);
    return buffers;
  }
  const single = await pullDemoAndClearLiveScore(admin, dathostServerId(), matchId, baseName, opts);
  return [single];
}
