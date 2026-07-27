// Live in-match score, derived from MatchZy remote-log events (`going_live`, `round_end`,
// `map_result`) and shown on the match page while a match is actually being played — well before the
// demo lands. `live_match_score` is a one-row-per-match table (Postgres, in the `supabase_realtime`
// publication) rather than an R2 artifact, so the match page can subscribe to it directly the same way
// `MatchServerPanel` subscribes to `matches` — no polling. The row is deleted once demo-ingest.ts has
// something to show in its place (a confirmed score or a staged review), not at `map_result` — that
// keeps the display up without a gap through the ~2-5 minutes GOTV/parsing takes after the match ends.
//
// Field names for `round_end`'s payload are inferred from `map_result`'s confirmed shape (`matchid`,
// `team1.score`/`team2.score` — `buildMatchzyConfig` fixes team1 = SHIRTS, team2 = SKINS) since
// MatchZy's docs site couldn't be reached to confirm it directly. `parseLiveScoreEvent` fails soft
// (returns `null`) on an unrecognized shape rather than throwing, so a wrong guess here just means the
// live display doesn't update for that event — verify against a real match's captured payload and
// adjust the accepted round-number keys below if needed. `map_result` reuses the same `team1`/`team2`
// reader as `round_end` (it's the same shape, just with no round number).

import type { SupabaseClient } from '@supabase/supabase-js';

export interface LiveScoreRow {
  matchId: number;
  shirts: number;
  skins: number;
  /** Rounds completed so far, or `null` when not reported (`going_live`, or `map_result`, which
   *  doesn't carry a round number). */
  round: number | null;
}

/** Raw `live_match_score` columns, as both a Postgres `select()` and a Realtime `payload.new` return
 *  them. Shared by `getLiveScore` below and `LiveScoreTicker`'s Realtime handler so the snake_case →
 *  camelCase mapping lives in exactly one place. */
export interface LiveScoreDbRow {
  shirts_score: number;
  skins_score: number;
  round: number | null;
}

export function rowToLiveScore(matchId: number, row: LiveScoreDbRow): LiveScoreRow {
  return { matchId, shirts: row.shirts_score, skins: row.skins_score, round: row.round };
}

/** `going_live` seeds the display at 0-0; `round_end`/`map_result` carry the running/final score.
 *  Anything else returns `null`. */
function parseLiveScoreEvent(body: unknown): LiveScoreRow | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const matchId = Number(b.matchid);
  if (!Number.isInteger(matchId) || matchId <= 0) return null;

  if (b.event === 'going_live') {
    return { matchId, shirts: 0, skins: 0, round: null };
  }

  if (b.event === 'round_end' || b.event === 'map_result') {
    const team1 = b.team1 as Record<string, unknown> | undefined;
    const team2 = b.team2 as Record<string, unknown> | undefined;
    const shirts = Number(team1?.score);
    const skins = Number(team2?.score);
    if (!Number.isInteger(shirts) || !Number.isInteger(skins) || shirts < 0 || skins < 0) return null;
    const roundRaw = b.round_number ?? b.roundnumber ?? b.round;
    const round = Number(roundRaw);
    return { matchId, shirts, skins, round: Number.isInteger(round) && round >= 0 ? round : null };
  }

  return null;
}

/** Parse a raw remote-log body and upsert it if it's a live-score-relevant event; a no-op for any
 *  other event type. */
export async function putLiveScoreEvent(admin: SupabaseClient, body: unknown): Promise<void> {
  const row = parseLiveScoreEvent(body);
  if (!row) return;
  await admin.from('live_match_score').upsert(
    {
      match_id: row.matchId,
      shirts_score: row.shirts,
      skins_score: row.skins,
      round: row.round,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'match_id' },
  );
}

export async function getLiveScore(admin: SupabaseClient, matchId: number): Promise<LiveScoreRow | null> {
  const { data } = await admin
    .from('live_match_score')
    .select('shirts_score, skins_score, round')
    .eq('match_id', matchId)
    .maybeSingle();
  if (!data) return null;
  return rowToLiveScore(matchId, data as LiveScoreDbRow);
}

/** Deleted once `demo-ingest.ts` has something to show in its place — see the header comment for why
 *  that's a better trigger than `map_result`. */
export async function clearLiveScore(admin: SupabaseClient, matchId: number): Promise<void> {
  await admin.from('live_match_score').delete().eq('match_id', matchId);
}
