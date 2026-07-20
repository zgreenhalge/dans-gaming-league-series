import { gunzipMaybe } from '../gzip';
import { supabase } from '../supabase';
import { getR2Object, replayKey, traceKey, mapTraceKey } from '../r2';
import type { ReplayPayload, ReplayPlayerMeta, ReplayEvent } from '../replay/types';
import { extractPlayerTrace, type PlayerTrace, type MatchTraceArtifact } from '../replay/aggregate';
import type { Faction, ReplayStatus } from '../types';

export type { ReplayStatus };

// --- Match replay / events (issue #121; see docs/replay.md) ---

export interface ReplayJobState {
  status: ReplayStatus;
  stage: string | null;
  ghRunUrl: string | null;
  errorMessage: string | null;
}

/**
 * Read a match's replay status + latest job state. Defensive: if the
 * `replay_status` column / `background_jobs` table don't exist yet (the user
 * adds them in the Supabase dashboard — see docs/replay.md), this returns
 * `'none'` so the match page never breaks.
 */
export async function getReplayJobState(matchId: number): Promise<ReplayJobState> {
  const none: ReplayJobState = { status: 'none', stage: null, ghRunUrl: null, errorMessage: null };
  try {
    // Independent reads — run them together to avoid a serial round-trip on the
    // (hot) match page render.
    const [{ data: matchRow, error: matchErr }, { data: jobRow }] = await Promise.all([
      supabase.from('matches').select('replay_status').eq('id', matchId).maybeSingle(),
      supabase
        .from('background_jobs')
        .select('stage, gh_run_url, error_message')
        .eq('job_type', 'replay_extract')
        .eq('match_id', matchId)
        .maybeSingle(),
    ]);
    if (matchErr) return none;
    const status = ((matchRow as { replay_status?: string } | null)?.replay_status ??
      'none') as ReplayStatus;

    const job = jobRow as
      | { stage: string | null; gh_run_url: string | null; error_message: string | null }
      | null;

    return {
      status,
      stage: job?.stage ?? null,
      ghRunUrl: job?.gh_run_url ?? null,
      errorMessage: job?.error_message ?? null,
    };
  } catch {
    return none;
  }
}

export interface ReplayEventsRound {
  round: number;
  isKnifeRound?: boolean;
  sideByFaction: Record<Faction, 'CT' | 'T'>;
  events: ReplayEvent[];
}

export interface ReplayEventsView {
  players: ReplayPlayerMeta[];
  rounds: ReplayEventsRound[];
}

/**
 * Fetch the replay payload from R2 and project it down to just what the Events
 * tab needs (players + per-round events) — frames/grenades are dropped to keep
 * the client payload small. Returns `null` if no replay is present.
 */
export async function getReplayEventsView(matchId: number): Promise<ReplayEventsView | null> {
  const buf = await getR2Object(replayKey(matchId));
  if (!buf) return null;
  // Stored gzipped; tolerate either.
  const json = gunzipMaybe(buf);
  let payload: ReplayPayload;
  try {
    payload = JSON.parse(json.toString('utf8')) as ReplayPayload;
  } catch {
    return null;
  }
  return {
    players: payload.players,
    rounds: payload.rounds.map((r) => ({
      round: r.round,
      isKnifeRound: r.isKnifeRound,
      sideByFaction: r.sideByFaction,
      events: r.events,
    })),
  };
}

export interface PlayerRoundTraces {
  traces: PlayerTrace[];
  /** Taken from the first match with a ready replay and assumed constant across all of
   *  them (every DGLS match server runs the same tick rate) — `null` when none of
   *  `matchIds` had a ready replay to read it from. */
  tickRate: number | null;
}

/**
 * Read every rostered player's traces straight off each match's own full `replay.json`
 * — the original fan-out, still used as the fallback for matches a map's rollup
 * doesn't (yet) cover, e.g. any match extracted before the rollup existed. Matches
 * without a ready replay, or where the player isn't on the roster, are silently
 * skipped, same tolerance as `getMapHeatmap`.
 */
async function fetchPlayerTracesFromReplay(
  playerId: number,
  matchIds: number[],
): Promise<{ traces: PlayerTrace[]; tickRate: number | null }> {
  const perMatch = await Promise.all(
    matchIds.map(async (matchId): Promise<{ traces: PlayerTrace[]; tickRate: number } | null> => {
      const buf = await getR2Object(replayKey(matchId));
      if (!buf) return null;
      let payload: ReplayPayload;
      try {
        payload = JSON.parse(gunzipMaybe(buf).toString('utf8')) as ReplayPayload;
      } catch {
        return null;
      }
      const faction = payload.players.find((p) => p.id === playerId)?.faction ?? null;
      if (faction === null) return null;
      const traces: PlayerTrace[] = [];
      for (const round of payload.rounds) {
        const trace = extractPlayerTrace(matchId, round, playerId, faction);
        if (trace) traces.push(trace);
      }
      return { traces, tickRate: payload.tickRate };
    }),
  );
  const present = perMatch.filter((r): r is { traces: PlayerTrace[]; tickRate: number } => r !== null);
  return {
    traces: present.flatMap((r) => r.traces),
    tickRate: present[0]?.tickRate ?? null,
  };
}

/** One player's trace tagged with match context, as merged into a map's trace rollup. */
export interface MapTraceRollupEntry {
  playerId: number;
  faction: Faction;
  tickRate: number;
  trace: PlayerTrace;
}

/**
 * A map's merged player-trace rollup (issue #127) — every rostered player's traces
 * across every match played on the map, precomputed by the `replay-extract` Action
 * from each match's compact `MatchTraceArtifact` instead of fanning out live over full
 * `replay.json` payloads. `matchIds` records which matches are currently folded in.
 */
export interface MapTraceRollup {
  version: number; // === MAP_TRACE_ROLLUP_VERSION (see replay/aggregate.ts)
  slug: string;
  matchIds: number[];
  entries: MapTraceRollupEntry[];
}

/**
 * Aggregate the compact per-match `traces.json` artifacts for a set of matches into a
 * flat, player-tagged list — the Action's own merge step when (re)building a map's
 * trace rollup. Matches without a generated trace artifact are silently skipped.
 */
export async function getMapTraces(matchIds: number[]): Promise<MapTraceRollupEntry[]> {
  const perMatch = await Promise.all(
    matchIds.map(async (matchId): Promise<MapTraceRollupEntry[]> => {
      const buf = await getR2Object(traceKey(matchId));
      if (!buf) return [];
      try {
        const art = JSON.parse(gunzipMaybe(buf).toString('utf8')) as MatchTraceArtifact;
        return art.players.flatMap((p) =>
          p.traces.map((trace) => ({ playerId: p.playerId, faction: p.faction, tickRate: art.tickRate, trace })),
        );
      } catch {
        return [];
      }
    }),
  );
  return perMatch.flat();
}

/**
 * Read a map's precomputed trace rollup (issue #127), or `null` if none has been
 * built yet.
 */
export async function getMapTraceRollup(slug: string): Promise<MapTraceRollup | null> {
  const buf = await getR2Object(mapTraceKey(slug));
  if (!buf) return null;
  try {
    return JSON.parse(gunzipMaybe(buf).toString('utf8')) as MapTraceRollup;
  } catch {
    return null;
  }
}

/**
 * Aggregate one player's per-round position trace across several matches — the source
 * for the "replay all of a player's rounds" overlay (#128), both scoped to a single
 * match (traces from one payload) and career-wide across every match a player has
 * played on a map (this function, fanned out over `matchIds`). When `slug` is given,
 * matches the map's trace rollup already covers are read from there (one R2 GET total);
 * any match it doesn't cover falls back to `fetchPlayerTracesFromReplay` — same
 * always-correct-first, fast-once-precomputed shape as `getMapHeatmap`'s route.
 */
export async function getPlayerRoundTraces(
  playerId: number,
  matchIds: number[],
  slug?: string | null,
): Promise<PlayerRoundTraces> {
  const rollup = slug ? await getMapTraceRollup(slug) : null;
  const covered = new Set(rollup?.matchIds ?? []);
  const requested = new Set(matchIds);

  const traces: PlayerTrace[] = [];
  let tickRate: number | null = null;
  if (rollup) {
    for (const entry of rollup.entries) {
      if (entry.playerId !== playerId || !requested.has(entry.trace.matchId)) continue;
      traces.push(entry.trace);
      tickRate ??= entry.tickRate;
    }
  }

  const missing = matchIds.filter((id) => !covered.has(id));
  if (missing.length > 0) {
    const fallback = await fetchPlayerTracesFromReplay(playerId, missing);
    traces.push(...fallback.traces);
    tickRate ??= fallback.tickRate;
  }

  return { traces, tickRate };
}
