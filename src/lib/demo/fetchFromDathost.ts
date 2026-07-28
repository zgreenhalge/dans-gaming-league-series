// Pulls a match's GOTV demo directly from the DatHost game server's file storage, rather than waiting
// for MatchZy to push it. MatchZy's push (`matchzy_demo_upload_url`) hit Cloudflare's inbound request
// body cap on a large (~226MB) demo — a platform limit outside our control, and MatchZy has no upload
// compression option. Pulling sidesteps the cap entirely: it's an outbound GET from the demo-ingest
// Action, not an inbound POST through Cloudflare's edge.
//
// The remote path is deterministic — `infra/matchzy/cfg/MatchZy/config.cfg` sets
// `matchzy_demo_path MatchZy/` and `matchzy_demo_name_format "{MATCH_ID}"`, so every match's demo lands
// at `MatchZy/{matchId}.dem` with no directory listing/discovery needed.

import { gzipSync } from 'node:zlib';
import { DathostError, getFileBytes, pollUntil } from '../dathost';
import { getR2Object, putR2Object, demoKey } from '../r2';

// GOTV's flush delay holds the demo back for ~120s after `map_result`
// (`tvFlushDelay`/`mp_match_restart_delay` in MatchZy's own match-end handling); comfortably longer.
const FETCH_TIMEOUT_MS = 5 * 60_000;
const FETCH_INTERVAL_MS = 10_000;

// `demo-ingest.yml` and `replay-extract.yml` are auto-dispatched together off the same `map_result`
// event and tend to detect the demo on the same DatHost poll cycle, so both would otherwise pull,
// gzip, and upload the same ~200MB+ file. A caller that can treat demo-ingest as the pull's owner
// (`waitForConcurrentPull`) waits out this window polling R2 instead — much cheaper than DatHost —
// before falling back to pulling it itself. The wait has to be at least as long as `FETCH_TIMEOUT_MS`:
// demo-ingest can't land the object in R2 any sooner than its own DatHost poll succeeds, so a shorter
// grace window would time out before demo-ingest could possibly be done, defeating the point.
const CONCURRENT_PULL_GRACE_MS = FETCH_TIMEOUT_MS;
const CONCURRENT_PULL_INTERVAL_MS = 5_000;

/** The deterministic remote path a match's demo is saved at, given the golden cfg above. */
function demoRemotePath(matchId: number): string {
  return `MatchZy/${matchId}.dem`;
}

/** Whether `err` is `pollUntil`'s own deadline-exceeded signal — safe to treat as "nothing landed
 *  yet, fall back to pulling it ourselves" — rather than a real R2 read failure (bad credentials,
 *  network partition) that should propagate instead of being silently masked. `getR2Object` never
 *  throws `DathostError` itself (only `pollUntil`'s own timeout branch does), so this is exact, not
 *  a heuristic. Exported for testing. */
export function isPollTimeout(err: unknown): boolean {
  return err instanceof DathostError;
}

/** Poll R2 (not DatHost) for up to `CONCURRENT_PULL_GRACE_MS`, in case another already-running pull
 *  is about to land the demo. Returns `null` on timeout rather than throwing — that's the caller's
 *  cue to fall back to pulling it itself, not a failure. A non-timeout error (a real R2 read
 *  failure) propagates instead of being swallowed. */
async function waitForConcurrentPull(matchId: number): Promise<Buffer | null> {
  try {
    return await pollUntil(() => getR2Object(demoKey(matchId)), {
      timeoutMs: CONCURRENT_PULL_GRACE_MS,
      intervalMs: CONCURRENT_PULL_INTERVAL_MS,
      timeoutMessage: `${demoKey(matchId)} not in R2 after waiting on a concurrent pull`,
    });
  } catch (err) {
    if (isPollTimeout(err)) return null;
    throw err;
  }
}

/** Poll DatHost for a match's demo until it appears, gzip-write it to R2 at `demoKey(matchId)`, and
 *  return those same gzipped bytes (so `ensureDemoInR2` doesn't have to read them straight back).
 *  Throws if it never shows up within `FETCH_TIMEOUT_MS`. */
async function fetchDemoFromDathost(serverId: string, matchId: number): Promise<Buffer> {
  const remote = demoRemotePath(matchId);
  const bytes = await pollUntil(() => getFileBytes(serverId, remote), {
    timeoutMs: FETCH_TIMEOUT_MS,
    intervalMs: FETCH_INTERVAL_MS,
    timeoutMessage: `Demo never appeared at ${remote} on server ${serverId} after ${Math.round(FETCH_TIMEOUT_MS / 1000)}s`,
  });
  const gzipped = gzipSync(bytes);
  await putR2Object(demoKey(matchId), gzipped, {
    contentType: 'application/octet-stream',
    contentEncoding: 'gzip',
  });
  return gzipped;
}

/** The match's demo bytes (still gzipped, as stored), pulling it from DatHost first if it isn't
 *  already in R2. Shared by `demo-ingest.ts` and `replay-extract.ts` so neither re-derives the same
 *  check-then-pull sequence.
 *
 *  `shouldWaitForConcurrentPull`: called only on an R2 miss (never on the common already-cached path)
 *  to decide whether another already-dispatched job actually owns this pull — if so, wait out
 *  `waitForConcurrentPull()`'s grace window (polling R2, not DatHost) before pulling from DatHost
 *  ourselves. `replay-extract.ts` passes a check for a claimed `demo_ingest` job row; `demo-ingest.ts`
 *  itself omits this entirely, since nothing else pulls the demo when it's the only job running. */
export async function ensureDemoInR2(
  serverId: string,
  matchId: number,
  opts: { shouldWaitForConcurrentPull?: () => Promise<boolean> } = {},
): Promise<Buffer> {
  const existing = await getR2Object(demoKey(matchId));
  if (existing) return existing;

  if (opts.shouldWaitForConcurrentPull && (await opts.shouldWaitForConcurrentPull())) {
    const landed = await waitForConcurrentPull(matchId);
    if (landed) return landed;
  }

  return fetchDemoFromDathost(serverId, matchId);
}
