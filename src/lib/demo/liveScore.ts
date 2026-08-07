// Live in-match score, derived from MatchZy remote-log events (`going_live`, `round_end`,
// `map_result`) and shown on the match page while a match is actually being played — well before the
// demo lands. `live_match_score` is a one-row-per-match table (Postgres, in the `supabase_realtime`
// publication) rather than an R2 artifact, so the match page can subscribe to it directly the same way
// `MatchServerPanel` subscribes to `matches` — no polling. `match_id` is this table's primary key, so
// Postgres's default replica identity (which always includes the primary key) is enough for Realtime
// to deliver DELETE events matching a `match_id=eq.` filter — no `REPLICA IDENTITY FULL` needed; if
// this table's key ever changes, re-verify that.
//
// The row is cleared as soon as the match's demo is confirmed present in R2 — `demo-ingest.ts` and
// `replay-extract.ts` both call `clearLiveScoreBestEffort()` right after their own `ensureDemoInR2()`
// call resolves, so whichever of them actually owns the pull clears it, and the other's redundant call
// is a cheap no-op. Not at `map_result` (GOTV's flush can lag well behind the event, so the demo may
// not exist yet) and not once a score is confirmed (auto-commit or a human confirm can lag well behind
// the demo landing, especially for a quarantined/staged-for-review match). A demo existing is proof
// the match is over regardless of whether its stats have been derived yet, so that's the point the
// "Live" label should stop being true. `writeMatchScore()` (`matchScore.ts`) also clears the row as a
// fallback, for the rare case a score gets confirmed with no demo ever pulled (e.g. a manual override
// after a failed DatHost pull) — by the time any demo-backed score lands, this has always already run.
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
  /** When this row was last written — lets a consumer that reads from more than one source (an
   *  initial GET racing a Realtime subscription, e.g. `LiveScoreTicker`) tell which one is newer
   *  instead of trusting arrival order. */
  updatedAt: string;
}

/** Raw `live_match_score` columns, as both a Postgres `select()` and a Realtime `payload.new` return
 *  them. Shared by `getLiveScore` below and `LiveScoreTicker`'s Realtime handler so the snake_case →
 *  camelCase mapping lives in exactly one place. */
export interface LiveScoreDbRow {
  shirts_score: number;
  skins_score: number;
  round: number | null;
  updated_at: string;
}

export function rowToLiveScore(matchId: number, row: LiveScoreDbRow): LiveScoreRow {
  return { matchId, shirts: row.shirts_score, skins: row.skins_score, round: row.round, updatedAt: row.updated_at };
}

/** A live-score update's position in time for a given match — its `updated_at`, or `'deleted'` once
 *  the row's gone (a delete carries no timestamp to compare, and is always the last word for that
 *  match). */
export type LiveScoreVersion = string | 'deleted';

/**
 * Guards a live-score display fed by more than one out-of-order source — an initial GET racing a
 * Realtime subscription, both `MatchScoreHero` (one fixed match for its whole mount) and
 * `LiveMatchTicker` (the match it's tracking can change over time, as different matches go live) hit
 * this same race. Returns an `accept(matchId, version)` function: call it with each update as it
 * arrives, and only apply the accompanying value when it returns `true`.
 *
 * An update for a *different* match than the last-accepted one is always accepted — that's
 * unambiguously fresh, not a race. An update for the *same* match is accepted only if it's newer than
 * what's already landed; once that match's version is `'deleted'`, nothing else for it is accepted
 * (a live score never comes back for a scored match) — but a later update naming a different match
 * still is, so the guard itself isn't a one-shot: it keeps working for whatever match comes next. */
export function createLiveScoreGuard() {
  let state: { matchId: number; version: LiveScoreVersion } | null = null;
  return function accept(matchId: number, version: LiveScoreVersion): boolean {
    if (state && state.matchId === matchId) {
      if (state.version === 'deleted') return false;
      if (version !== 'deleted' && version <= state.version) return false;
    }
    state = { matchId, version };
    return true;
  };
}

/** What's parsed out of an incoming remote-log body — no `updatedAt`, since that's stamped at write
 *  time, not carried by the event itself. */
interface ParsedLiveScoreEvent {
  matchId: number;
  shirts: number;
  skins: number;
  round: number | null;
}

/** `going_live` seeds the display at 0-0; `round_end`/`map_result` carry the running/final score.
 *  Anything else returns `null`. */
function parseLiveScoreEvent(body: unknown): ParsedLiveScoreEvent | null {
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
    .select('shirts_score, skins_score, round, updated_at')
    .eq('match_id', matchId)
    .maybeSingle();
  if (!data) return null;
  return rowToLiveScore(matchId, data as LiveScoreDbRow);
}

/** Called once the match's demo is confirmed present in R2, with `writeMatchScore()` calling it too
 *  as a fallback — see the header comment for why. */
export async function clearLiveScore(admin: SupabaseClient, matchId: number): Promise<void> {
  await admin.from('live_match_score').delete().eq('match_id', matchId);
}

/** `clearLiveScore`, swallowing (and logging) a failure instead of throwing — every caller treats
 *  clearing the ticker as best-effort, since it must never fail an otherwise-successful demo pull or
 *  score write. Shared so each call site doesn't restate the same try/catch. */
export async function clearLiveScoreBestEffort(admin: SupabaseClient, matchId: number): Promise<void> {
  try {
    await clearLiveScore(admin, matchId);
  } catch (e) {
    console.error(`clearLiveScore(${matchId}) failed (non-fatal):`, e);
  }
}
