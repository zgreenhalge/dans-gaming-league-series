// Tracks the last MatchZy remote-log event received for a match, regardless of event type — unlike
// `mapResult.ts`, which only keeps the one `map_result` payload the auto-commit cross-check needs.
// Written by every authenticated hit to `POST /api/ingest/matchzy-log`. Read by the admin jobs
// dashboard to distinguish "the remote-log webhook never reached us at all for this match" from "it
// reached us, but the demo upload specifically never did" — a distinction otherwise only checkable by
// live RCON on the game server mid-match.

import { gzipSync } from 'node:zlib';
import { getR2Object, putR2Object, matchzyContactKey } from '../r2';
import { gunzipMaybe } from '../gzip';

export interface MatchzyContact {
  event: string;
  receivedAt: string;
}

/** Best-effort `{ event, matchid }` extraction from any MatchZy remote-log payload — every event type
 *  carries these two fields, even ones whose other fields go unread (only `map_result` is parsed in
 *  full, by `parseMapResultEvent`). */
export function parseMatchzyEventIdentity(body: unknown): { event: string; matchid: number } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const event = typeof b.event === 'string' ? b.event : null;
  const matchid = Number(b.matchid);
  if (!event || !Number.isInteger(matchid) || matchid <= 0) return null;
  return { event, matchid };
}

/** Record that MatchZy contacted us for `matchId` — overwrites any earlier contact, since only the
 *  most recent one matters for this signal. */
export async function putMatchzyContact(matchId: number, event: string): Promise<void> {
  const contact: MatchzyContact = { event, receivedAt: new Date().toISOString() };
  await putR2Object(matchzyContactKey(matchId), gzipSync(Buffer.from(JSON.stringify(contact))), {
    contentType: 'application/json',
    contentEncoding: 'gzip',
  });
}

/** Read the last recorded MatchZy contact for a match, or `null` if none was ever recorded (or it's
 *  unreadable). */
export async function getMatchzyContact(matchId: number): Promise<MatchzyContact | null> {
  const buf = await getR2Object(matchzyContactKey(matchId));
  if (!buf) return null;
  try {
    return JSON.parse(gunzipMaybe(buf).toString('utf8')) as MatchzyContact;
  } catch {
    return null;
  }
}
