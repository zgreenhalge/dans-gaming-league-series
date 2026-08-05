// Pulls a match's GOTV demo directly from the DatHost game server's file storage, rather than waiting
// for MatchZy to push it. MatchZy's push (`matchzy_demo_upload_url`) hit Cloudflare's inbound request
// body cap on a large (~226MB) demo — a platform limit outside our control, and MatchZy has no upload
// compression option. Pulling sidesteps the cap entirely: it's an outbound GET from the demo-ingest
// Action, not an inbound POST through Cloudflare's edge.
//
// The remote path is deterministic — `infra/matchzy/cfg/MatchZy/config.cfg` sets
// `matchzy_demo_path MatchZy/`, and `buildMatchzyConfig` (`../matchzy.ts`) sets the per-match
// `matchzy_demo_name_format` cvar to `demoBaseName()`'s output — so every match's demo lands at
// `MatchZy/{demoBaseName}.dem` with no directory listing/discovery needed. Callers pass that same
// `demoBaseName` in (computed the same way `buildMatchzyConfig` did, from the match's own data) rather
// than this file recomputing it, so the two sides can't independently drift apart.

import { gzipSync } from 'node:zlib';
import { DathostError, getFileBytes, getFileSize, pollUntil } from '../dathost';
import { getR2Object, putR2Object, demoKey } from '../r2';

// GOTV's recording (`tv_record`) starts at match go-live, not at match end, so the file at
// `demoRemotePath` already exists — and is still growing — for the whole match. A poll that only
// checks "does this path resolve" would happily grab a still-growing recording the moment it's
// dispatched; `fetchDemoFromDathost` instead waits out `FLUSH_FLOOR_MS` — GOTV's own flush delay
// after `map_result` (`tvFlushDelay`/`mp_match_restart_delay` in MatchZy's match-end handling) —
// before ever checking, then confirms the file has actually stopped growing (the flush isn't a fixed
// duration) before trusting it.
const FLUSH_FLOOR_MS = 120_000;

// After the floor, two consecutive size reads that agree mean the file has stopped growing.
// Backed off exponentially between checks since there's no fixed cadence for how long a flush past
// the floor takes.
const STABILITY_CHECK_BASE_MS = 5_000;
const STABILITY_CHECK_MAX_MS = 30_000;

// Overall ceiling on the fetch, floor included — comfortably longer than the floor plus a realistic
// run of backed-off stability checks.
const FETCH_TIMEOUT_MS = 8 * 60_000;

// `demo-ingest.yml` and `replay-extract.yml` are auto-dispatched together off the same `map_result`
// event and tend to detect the demo on the same DatHost poll cycle, so both would otherwise pull,
// gzip, and upload the same ~200MB+ file. A caller that can treat demo-ingest as the pull's owner
// (`waitForConcurrentPull`) waits out this window polling R2 instead — much cheaper than DatHost —
// before falling back to pulling it itself. The wait has to be at least as long as `FETCH_TIMEOUT_MS`:
// demo-ingest can't land the object in R2 any sooner than its own DatHost poll succeeds, so a shorter
// grace window would time out before demo-ingest could possibly be done, defeating the point.
const CONCURRENT_PULL_GRACE_MS = FETCH_TIMEOUT_MS;
const CONCURRENT_PULL_INTERVAL_MS = 5_000;

/** The deterministic remote path a match's demo is saved at, given `demoBaseName` (`../matchzy.ts`). */
function demoRemotePath(demoBaseName: string): string {
  return `MatchZy/${demoBaseName}.dem`;
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

/** `setTimeout` as a promise — the plain sleep this file's floor/backoff waits need. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Waits for the file at `remote` to report the same size on two consecutive checks — still-growing
 *  files, and ones DatHost can't yet resolve a size for, never satisfy this — backing off
 *  exponentially between checks. Throws once `deadline` passes with no two agreeing reads. */
async function waitForStableFileSize(serverId: string, remote: string, deadline: number): Promise<void> {
  let lastSize: number | null = null;
  let intervalMs = STABILITY_CHECK_BASE_MS;
  for (;;) {
    const size = await getFileSize(serverId, remote);
    if (size !== null && size === lastSize) return;
    lastSize = size;
    if (Date.now() >= deadline) {
      throw new DathostError(
        `Demo at ${remote} on server ${serverId} never stabilized in size before the deadline`,
        504,
        null,
      );
    }
    await sleep(intervalMs);
    intervalMs = Math.min(intervalMs * 2, STABILITY_CHECK_MAX_MS);
  }
}

/** Wait out `FLUSH_FLOOR_MS`, confirm the file's size has stabilized, then download it and gzip-write
 *  it to R2 at `demoKey(matchId)`, returning those same gzipped bytes (so `ensureDemoInR2` doesn't
 *  have to read them straight back). Throws if it never stabilizes within `FETCH_TIMEOUT_MS`. */
async function fetchDemoFromDathost(serverId: string, matchId: number, demoBaseName: string): Promise<Buffer> {
  const remote = demoRemotePath(demoBaseName);
  const deadline = Date.now() + FETCH_TIMEOUT_MS;

  await sleep(FLUSH_FLOOR_MS);
  await waitForStableFileSize(serverId, remote, deadline);

  const bytes = await getFileBytes(serverId, remote);
  if (!bytes) {
    throw new DathostError(`Demo at ${remote} on server ${serverId} disappeared right after stabilizing`, 504, null);
  }

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
 *  `demoBaseName`: the same string `buildMatchzyConfig` (`../matchzy.ts`) computed and set as the
 *  match's `matchzy_demo_name_format` cvar — callers get it from `demoBaseName()` there, fed the
 *  match's own `matchId`/`scheduledAt`/map, not from this file re-deriving it.
 *
 *  `shouldWaitForConcurrentPull`: called only on an R2 miss (never on the common already-cached path)
 *  to decide whether another already-dispatched job actually owns this pull — if so, wait out
 *  `waitForConcurrentPull()`'s grace window (polling R2, not DatHost) before pulling from DatHost
 *  ourselves. `replay-extract.ts` passes a check for a claimed `demo_ingest` job row; `demo-ingest.ts`
 *  itself omits this entirely, since nothing else pulls the demo when it's the only job running. */
export async function ensureDemoInR2(
  serverId: string,
  matchId: number,
  demoBaseName: string,
  opts: { shouldWaitForConcurrentPull?: () => Promise<boolean> } = {},
): Promise<Buffer> {
  const existing = await getR2Object(demoKey(matchId));
  if (existing) return existing;

  if (opts.shouldWaitForConcurrentPull && (await opts.shouldWaitForConcurrentPull())) {
    const landed = await waitForConcurrentPull(matchId);
    if (landed) return landed;
  }

  return fetchDemoFromDathost(serverId, matchId, demoBaseName);
}
