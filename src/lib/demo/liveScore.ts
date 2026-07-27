// Live in-match score, derived from MatchZy remote-log events (`going_live`, `round_end`,
// `map_result`) and shown on the match page while a match is actually being played — well before the
// demo lands. Overwritten on every relevant event, same "only the latest matters" pattern as
// `matchzyContact.ts`. Transient — cleared once the match is confirmed, same as `mapResultKey`.
//
// Field names for `round_end`'s payload are inferred from `map_result`'s confirmed shape (`matchid`,
// `team1.score`/`team2.score` — `buildMatchzyConfig` fixes team1 = SHIRTS, team2 = SKINS) since
// MatchZy's docs site couldn't be reached to confirm it directly. `parseLiveScoreEvent` fails soft
// (returns `null`) on an unrecognized shape rather than throwing, so a wrong guess here just means the
// live display doesn't update for that event — verify against a real match's captured payload and
// adjust the accepted round-number keys below if needed.

import { gzipSync } from 'node:zlib';
import { getR2Object, putR2Object, deleteR2Object } from '../r2';
import { gunzipMaybe } from '../gzip';
import type { MatchzyMapResult } from './mapResult';

export interface MatchzyLiveScore {
  matchid: number;
  event: string;
  shirts: number;
  skins: number;
  /** Rounds completed so far, or `null` when not reported (e.g. `going_live`, before round 1). */
  round: number | null;
  updatedAt: string;
}

function liveScoreKey(matchId: number): string {
  return `${matchId}/live-score.json`;
}

/** `going_live` seeds the display at 0-0; `round_end` carries the running score. Anything else (and
 *  `map_result`, handled separately via `liveScoreFromMapResult` since the route already has it
 *  parsed) returns `null`. */
export function parseLiveScoreEvent(body: unknown): MatchzyLiveScore | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const matchid = Number(b.matchid);
  if (!Number.isInteger(matchid) || matchid <= 0) return null;

  if (b.event === 'going_live') {
    return { matchid, event: 'going_live', shirts: 0, skins: 0, round: null, updatedAt: new Date().toISOString() };
  }

  if (b.event === 'round_end') {
    const team1 = b.team1 as Record<string, unknown> | undefined;
    const team2 = b.team2 as Record<string, unknown> | undefined;
    const shirts = Number(team1?.score);
    const skins = Number(team2?.score);
    if (!Number.isInteger(shirts) || !Number.isInteger(skins) || shirts < 0 || skins < 0) return null;
    const roundRaw = b.round_number ?? b.roundnumber ?? b.round;
    const round = Number(roundRaw);
    return {
      matchid,
      event: 'round_end',
      shirts,
      skins,
      round: Number.isInteger(round) && round >= 0 ? round : null,
      updatedAt: new Date().toISOString(),
    };
  }

  return null;
}

/** The final `map_result` score, in the same shape, so it becomes the live display's last write. */
export function liveScoreFromMapResult(result: MatchzyMapResult): MatchzyLiveScore {
  return {
    matchid: result.matchid,
    event: 'map_result',
    shirts: result.team1.score,
    skins: result.team2.score,
    round: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Parse a raw remote-log body and persist it if it's a live-score-relevant event; a no-op for any
 *  other event type. */
export async function putLiveScoreEvent(matchId: number, body: unknown): Promise<void> {
  const state = parseLiveScoreEvent(body);
  if (!state) return;
  await putLiveScore(matchId, state);
}

export async function putLiveScore(matchId: number, state: MatchzyLiveScore): Promise<void> {
  await putR2Object(liveScoreKey(matchId), gzipSync(Buffer.from(JSON.stringify(state))), {
    contentType: 'application/json',
    contentEncoding: 'gzip',
  });
}

export async function getLiveScore(matchId: number): Promise<MatchzyLiveScore | null> {
  const buf = await getR2Object(liveScoreKey(matchId));
  if (!buf) return null;
  try {
    return JSON.parse(gunzipMaybe(buf).toString('utf8')) as MatchzyLiveScore;
  } catch {
    return null;
  }
}

/** Cleared alongside `demoResultKey`/`mapResultKey` once a match is confirmed — stale live-score data
 *  has no reason to linger past that point. */
export async function deleteLiveScore(matchId: number): Promise<void> {
  await deleteR2Object(liveScoreKey(matchId));
}
