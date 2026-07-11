// Shape + R2 read/write for MatchZy's `map_result` remote-log event — the independent cross-check
// trusted auto-commit (#138) uses to corroborate the demo-derived score. Written by
// `POST /api/ingest/matchzy-log` (the `matchzy_remote_log_url` target), read by the demo-ingest
// Action. Every other MatchZy remote-log event type is ignored at the route — this is the only shape
// that ever reaches R2.

import { gzipSync } from 'node:zlib';
import { getR2Object, putR2Object, mapResultKey } from '../r2';
import { gunzipMaybe } from '../gzip';

export interface MatchzyMapResult {
  matchid: number;
  team1: { score: number };
  team2: { score: number };
}

/** Parse+validate a remote-log event body as a `map_result`. Returns null for any other event type,
 *  or a `map_result` missing the fields the auto-commit cross-check needs. */
export function parseMapResultEvent(body: unknown): MatchzyMapResult | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.event !== 'map_result') return null;

  const matchid = Number(b.matchid);
  const team1 = b.team1 as Record<string, unknown> | undefined;
  const team2 = b.team2 as Record<string, unknown> | undefined;
  const score1 = Number(team1?.score);
  const score2 = Number(team2?.score);
  if (!Number.isInteger(matchid) || matchid <= 0) return null;
  if (!Number.isInteger(score1) || !Number.isInteger(score2) || score1 < 0 || score2 < 0) return null;

  return { matchid, team1: { score: score1 }, team2: { score: score2 } };
}

/** Persist a validated `map_result` event to R2, gzipped. */
export async function putMapResult(matchId: number, result: MatchzyMapResult): Promise<void> {
  await putR2Object(mapResultKey(matchId), gzipSync(Buffer.from(JSON.stringify(result))), {
    contentType: 'application/json',
    contentEncoding: 'gzip',
  });
}

/** Read the staged `map_result` for a match, or null if MatchZy hasn't posted one (yet), or its shape
 *  is unreadable. */
export async function getMapResult(matchId: number): Promise<MatchzyMapResult | null> {
  const buf = await getR2Object(mapResultKey(matchId));
  if (!buf) return null;
  try {
    return JSON.parse(gunzipMaybe(buf).toString('utf8')) as MatchzyMapResult;
  } catch {
    return null;
  }
}
