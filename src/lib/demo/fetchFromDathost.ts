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
import { getFileBytes, pollUntil } from '../dathost';
import { getR2Object, putR2Object, demoKey } from '../r2';

// GOTV's flush delay holds the demo back for ~120s after `map_result`
// (`tvFlushDelay`/`mp_match_restart_delay` in MatchZy's own match-end handling); comfortably longer.
const FETCH_TIMEOUT_MS = 5 * 60_000;
const FETCH_INTERVAL_MS = 10_000;

/** The deterministic remote path a match's demo is saved at, given the golden cfg above. */
export function demoRemotePath(matchId: number): string {
  return `MatchZy/${matchId}.dem`;
}

/** Poll DatHost for a match's demo until it appears and gzip-write it to R2 at `demoKey(matchId)`.
 *  Throws if it never shows up within `FETCH_TIMEOUT_MS`. */
export async function fetchDemoFromDathost(serverId: string, matchId: number): Promise<void> {
  const remote = demoRemotePath(matchId);
  const bytes = await pollUntil(() => getFileBytes(serverId, remote), {
    timeoutMs: FETCH_TIMEOUT_MS,
    intervalMs: FETCH_INTERVAL_MS,
    timeoutMessage: `Demo never appeared at ${remote} on server ${serverId} after ${Math.round(FETCH_TIMEOUT_MS / 1000)}s`,
  });
  await putR2Object(demoKey(matchId), gzipSync(bytes), {
    contentType: 'application/octet-stream',
    contentEncoding: 'gzip',
  });
}

/** The match's demo bytes (still gzipped, as stored), pulling it from DatHost first if it isn't
 *  already in R2. Shared by `demo-ingest.ts` and `replay-extract.ts` so neither re-derives the same
 *  check-then-pull sequence. */
export async function ensureDemoInR2(serverId: string, matchId: number): Promise<Buffer> {
  const existing = await getR2Object(demoKey(matchId));
  if (existing) return existing;
  await fetchDemoFromDathost(serverId, matchId);
  const raw = await getR2Object(demoKey(matchId));
  if (!raw) throw new Error(`Demo still missing from R2 at ${demoKey(matchId)} after pulling from DatHost`);
  return raw;
}
