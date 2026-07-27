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
import { getFileBytes } from '../dathost';
import { putR2Object, demoKey } from '../r2';

/** The deterministic remote path a match's demo is saved at, given the golden cfg above. */
export function demoRemotePath(matchId: number): string {
  return `MatchZy/${matchId}.dem`;
}

/**
 * Poll DatHost for a match's demo until it appears (GOTV's flush delay holds it back for ~120s after
 * `map_result`, per `tvFlushDelay`/`mp_match_restart_delay` in MatchZy's own match-end handling) and
 * gzip-write it to R2 at `demoKey(matchId)`. Throws if it never shows up within `timeoutMs`.
 */
export async function fetchDemoFromDathost(
  serverId: string,
  matchId: number,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const intervalMs = opts.intervalMs ?? 10_000;
  const remote = demoRemotePath(matchId);
  const start = Date.now();
  for (;;) {
    const bytes = await getFileBytes(serverId, remote);
    if (bytes) {
      await putR2Object(demoKey(matchId), gzipSync(bytes), {
        contentType: 'application/octet-stream',
        contentEncoding: 'gzip',
      });
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Demo never appeared at ${remote} on server ${serverId} after ${Math.round(timeoutMs / 1000)}s`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
