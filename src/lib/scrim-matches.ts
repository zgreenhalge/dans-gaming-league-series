// Scrim night matches: the lobby rules (when a match can still be changed) and the writes behind
// creating, editing and discarding one. Reads are `getScrimNightMatches()` (`queries/scrims.ts`);
// starting a match is the shared `provisionMatchServer()` path every match uses.
//
// A scrim match is a `matches` row with `scrim_night_id` set and no week, so league stats never see
// it (see `onlyLeagueMatches()`). Its map is chosen in the lobby — there's no ban/pick — and lives in
// `shirts_pick`, which `effectivePickedMap()` reads.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScrimTeams } from './scrim-matchmaking';

/** `match_server_state.server_state` values once a match has claimed the server — from then on its
 *  lineup and map are what the server loaded, so the lobby is locked. `failed` and `idle` don't
 *  lock it: a failed start can be fixed and retried. */
const LOCKING_SERVER_STATES = new Set(['provisioning', 'live', 'tearing_down', 'done']);

/** Whether a scrim match can still be changed or discarded: it has no score and hasn't been started. */
export function isScrimMatchEditable(m: { final_score: string | null; server_state: string | null }): boolean {
  return m.final_score === null && !(m.server_state !== null && LOCKING_SERVER_STATES.has(m.server_state));
}

/** Whether `matchId` is a scrim match (`scrim_night_id` set). */
export async function isScrimMatch(db: SupabaseClient, matchId: number): Promise<boolean> {
  const { data } = await db.from('matches').select('scrim_night_id').eq('id', matchId).maybeSingle().throwOnError();
  return (data as { scrim_night_id: number | null } | null)?.scrim_night_id != null;
}

/** Thrown by `createScrimMatch()` when the night already has a match without a score. */
export class UnplayedScrimMatchError extends Error {
  constructor() {
    super('Finish or discard the current match before making the next one.');
    this.name = 'UnplayedScrimMatchError';
  }
}

/** Creates the night's next match on `map` with `teams` (`create_scrim_match()`, one transaction).
 *  Returns the new match id. */
export async function createScrimMatch(db: SupabaseClient, nightId: number, map: string, teams: ScrimTeams): Promise<number> {
  const { data, error } = await db.rpc('create_scrim_match', {
    p_night_id: nightId,
    p_map: map,
    p_shirts: teams.shirts,
    p_skins: teams.skins,
  });
  if (error) {
    if (error.message.includes('unplayed-scrim-match')) throw new UnplayedScrimMatchError();
    throw error;
  }
  return data as number;
}

/** Replaces a scrim match's lineup (`set_scrim_match_lineup()`, one transaction). */
export async function setScrimMatchLineup(db: SupabaseClient, matchId: number, teams: ScrimTeams): Promise<void> {
  const { error } = await db.rpc('set_scrim_match_lineup', { p_match_id: matchId, p_shirts: teams.shirts, p_skins: teams.skins });
  if (error) throw error;
}

/** Sets a scrim match's map. */
export async function setScrimMatchMap(db: SupabaseClient, matchId: number, map: string): Promise<void> {
  await db.from('matches').update({ shirts_pick: map }).eq('id', matchId).not('scrim_night_id', 'is', null).throwOnError();
}

/** Deletes a scrim match; its player rows (and anything else keyed to it) cascade. */
export async function deleteScrimMatch(db: SupabaseClient, matchId: number): Promise<void> {
  await db.from('matches').delete().eq('id', matchId).not('scrim_night_id', 'is', null).throwOnError();
}

/** Parses `{ shirts: [a, b], skins: [c, d] }` from a request body: two positive integer ids per side,
 *  four distinct players. `null` if it isn't one. */
export function parseScrimTeams(value: unknown): ScrimTeams | null {
  const v = value as { shirts?: unknown; skins?: unknown } | null;
  const pair = (x: unknown): [number, number] | null =>
    Array.isArray(x) && x.length === 2 && x.every((id) => Number.isInteger(id) && id > 0) ? [x[0], x[1]] : null;
  const shirts = pair(v?.shirts);
  const skins = pair(v?.skins);
  if (!shirts || !skins || new Set([...shirts, ...skins]).size !== 4) return null;
  return { shirts, skins };
}
