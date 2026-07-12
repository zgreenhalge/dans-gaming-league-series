import { gunzipMaybe } from '../gzip';
import { supabase } from '../supabase';
import { getR2Object, replayKey } from '../r2';
import type { ReplayPayload, ReplayPlayerMeta, ReplayEvent } from '../replay/types';
import type { Faction } from '../types';


// --- Match replay / events (issue #121; see docs/replay.md) ---

export type ReplayStatus = 'none' | 'queued' | 'running' | 'ready' | 'failed';

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
