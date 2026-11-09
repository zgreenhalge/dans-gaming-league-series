// Scrim night matches: the lobby rules (when a match can still be changed) and the writes behind
// creating, editing and discarding one. Reads are `getScrimNightMatches()` (`queries/scrims.ts`);
// starting a match is the shared `provisionMatchServer()` path every match uses.
//
// A scrim match is a `matches` row with `scrim_night_id` set and no week, so league stats never see
// it (see `onlyLeagueMatches()`). Its map is chosen in the lobby — there's no ban/pick — from any
// Steam Workshop item: the name lives in `shirts_pick`, which `effectivePickedMap()` reads, and the item
// id in `scrim_workshop_id`, which the server is started on (`resolveMapWorkshopId()`). Its starting side is the lobby's `ScrimSideChoice`
// (`scrim_side_choice`), turned into `skins_starting_side` only as the match starts
// (`applyScrimSideChoice()`), so a random side stays unknown until then.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScrimTeams } from './scrim-matchmaking';
import { isPlayedScore } from './util';
import { findScheduleCollision, type ScheduledMatchRef } from './server-schedule-collision';
import { SCRIM_LEAGUE_CLEARANCE_MS } from './scrim-schedule';
import { fetchWorkshopItem } from './workshop';

/** `match_server_state.server_state` values while a match holds the server. */
const RUNNING_SERVER_STATES = new Set(['provisioning', 'live', 'tearing_down']);

type ScrimMatchState = { final_score: string | null; server_state: string | null };

/** `server_state` values once a match's game is over: the scoreboard grace period before the server
 *  stops, then stopped. */
const GAME_OVER_SERVER_STATES = new Set(['tearing_down', 'done']);

/** A side's players as one label, "A + B", falling back to the id for a name that isn't known. */
export function scrimTeamLabel(ids: number[], names: Record<number, string>): string {
  return ids.map((id) => names[id] ?? `#${id}`).join(' + ');
}

/** Whether a scrim match still needs the night's server: not scored, and its game isn't over. Once it
 *  is, the next match can go ahead (it takes the server over; see the provision route) while the demo
 *  is parsed or awaits review. The lobby holds the night's first such match. */
export function scrimMatchNeedsServer(m: ScrimMatchState): boolean {
  return !isPlayedScore(m.final_score) && !(m.server_state !== null && GAME_OVER_SERVER_STATES.has(m.server_state));
}

/** Whether a scrim match's map, side and lineup can still change: not scored and never started — once
 *  it has claimed the server (`done` included), they're what the server loaded. `failed` and `idle`
 *  don't lock it: a failed start can be fixed and retried. */
export function isScrimMatchEditable(m: ScrimMatchState): boolean {
  return !isPlayedScore(m.final_score) && (m.server_state === null || !(RUNNING_SERVER_STATES.has(m.server_state) || m.server_state === 'done'));
}

/** Whether a scrim match belongs in the night's match list: it has started (it holds or held the
 *  server) or its game is over. A match still waiting in the lobby, never started, is not listed. */
export function isScrimMatchListed(m: ScrimMatchState): boolean {
  return !scrimMatchNeedsServer(m) || !isScrimMatchEditable(m);
}

/** Whether a scrim match can be discarded: not scored, and not holding the server right now. That
 *  includes one whose server stopped without a score (a crash, or a demo still waiting for review on
 *  its match page). */
export function isScrimMatchDiscardable(m: ScrimMatchState): boolean {
  return !isPlayedScore(m.final_score) && !(m.server_state !== null && RUNNING_SERVER_STATES.has(m.server_state));
}

/** The scrim night a match belongs to, or `null` for a league match or an unknown id. */
export async function scrimNightIdOf(db: SupabaseClient, matchId: number): Promise<number | null> {
  const { data } = await db.from('matches').select('scrim_night_id').eq('id', matchId).maybeSingle().throwOnError();
  return (data as { scrim_night_id: number | null } | null)?.scrim_night_id ?? null;
}

/** Whether `matchId` is a scrim match (`scrim_night_id` set). */
export async function isScrimMatch(db: SupabaseClient, matchId: number): Promise<boolean> {
  return (await scrimNightIdOf(db, matchId)) !== null;
}

/** How a scrim match's starting sides are decided, picked in the lobby. */
export const SCRIM_SIDE_CHOICES = ['skins_t', 'shirts_t', 'knife', 'random'] as const;

export type ScrimSideChoice = (typeof SCRIM_SIDE_CHOICES)[number];

/** The `skins_starting_side` a choice becomes as the match starts: SKINS start T, SHIRTS start T (so
 *  SKINS start CT), no side for a knife round, or a coin flip for random. */
export function resolveScrimSide(choice: ScrimSideChoice, rand: () => number = Math.random): 'CT' | 'T' | null {
  if (choice === 'knife') return null;
  if (choice === 'random') return rand() < 0.5 ? 'T' : 'CT';
  return choice === 'skins_t' ? 'T' : 'CT';
}

/** Sets a scrim match's starting-side choice (`scrim_side_choice`), clearing any side an earlier start
 *  resolved so the next start applies the new choice. */
export async function setScrimMatchSideChoice(db: SupabaseClient, matchId: number, choice: ScrimSideChoice): Promise<void> {
  await db
    .from('matches')
    .update({ scrim_side_choice: choice, skins_starting_side: null })
    .eq('id', matchId)
    .not('scrim_night_id', 'is', null)
    .throwOnError();
}

/** Turns a scrim match's side choice into its `skins_starting_side` — called as the match starts,
 *  before the server loads its config, so a random side is flipped only then. A random side that's
 *  already been flipped is kept, so pressing Start again never changes the sides of a match the server
 *  already loaded. A no-op for a league match, which has no choice. */
export async function applyScrimSideChoice(db: SupabaseClient, matchId: number, rand: () => number = Math.random): Promise<void> {
  const { data } = await db.from('matches').select('scrim_side_choice, skins_starting_side').eq('id', matchId).maybeSingle().throwOnError();
  const row = data as { scrim_side_choice: ScrimSideChoice | null; skins_starting_side: 'CT' | 'T' | null } | null;
  const choice = row?.scrim_side_choice ?? null;
  if (choice === null || (choice === 'random' && row?.skins_starting_side != null)) return;
  await db.from('matches').update({ skins_starting_side: resolveScrimSide(choice, rand) }).eq('id', matchId).throwOnError();
}

/** The number of the earlier match `matchId` waits behind — the lowest-numbered of its night's
 *  `matches` that still `scrimMatchNeedsServer()`, when that isn't `matchId` — or `null` when it's next.
 *  A night plays its matches in `match_number` order on its one server. */
export function scrimMatchPlaysAfter(matches: (ScrimMatchState & { id: number; match_number: number })[], matchId: number): number | null {
  const match = matches.find((m) => m.id === matchId);
  if (!match) return null;
  const first = Math.min(...matches.filter(scrimMatchNeedsServer).map((m) => m.match_number));
  return first < match.match_number ? first : null;
}

/** The scheduled league match strictly within `SCRIM_LEAGUE_CLEARANCE_MS` of `now`, either side —
 *  one about to start, or one that started a moment ago and is still being played — or `null`. A
 *  scrim match can't start while there is one: the league match gets the one shared server. */
export function leagueMatchBlockingScrim(scheduled: ScheduledMatchRef[], now: Date): ScheduledMatchRef | null {
  return findScheduleCollision(now.toISOString(), scheduled, SCRIM_LEAGUE_CLEARANCE_MS);
}

/** Thrown by `queueScrimMatches()` when the night can't take new matches yet: it already has a match
 *  that still needs the server, or there is no map to start one on. */
export class ScrimMatchConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScrimMatchConflictError';
  }
}

/** A scrim match's map: its name (`shirts_pick`) and the workshop item the server loads. */
export interface ScrimMap {
  name: string;
  workshopId: string;
}

/** The map for workshop item `workshopId`: a known map keeps its name; any other item is named after
 *  its Steam title (`fetchWorkshopItem()`), or after its id when Steam can't be reached. `null` when
 *  Steam doesn't know the item. Nothing is added to `maps` — a scrim map stays on its match. */
export async function resolveScrimMap(workshopId: string, knownMaps: ScrimMap[], lookup: typeof fetchWorkshopItem = fetchWorkshopItem): Promise<ScrimMap | null> {
  const known = knownMaps.find((m) => m.workshopId === workshopId);
  if (known) return known;
  const item = await lookup(workshopId).catch(() => ({ title: null }));
  if (item === null) return null;
  return { name: item.title ?? `Workshop ${workshopId}`, workshopId };
}

/** Queues `lineups` as the night's next matches, numbered in order after its others
 *  (`queue_scrim_matches()`, one transaction) — one for an ad-hoc match, several for pre-matched
 *  rounds. Each starts on a random map from `maps` (every map the server can load) until its lobby
 *  changes it. Returns the new match ids in order. */
export async function queueScrimMatches(
  db: SupabaseClient,
  nightId: number,
  lineups: ScrimTeams[],
  maps: ScrimMap[],
  rand: () => number = Math.random,
): Promise<number[]> {
  if (maps.length === 0) throw new ScrimMatchConflictError('No maps with a workshop id to play on.');
  const { data, error } = await db.rpc('queue_scrim_matches', {
    p_night_id: nightId,
    p_matches: lineups.map((teams) => {
      const map = maps[Math.floor(rand() * maps.length)];
      return { map: map.name, workshop_id: map.workshopId, shirts: teams.shirts, skins: teams.skins };
    }),
  });
  if (error) {
    if (error.message.includes('unplayed-scrim-match')) {
      throw new ScrimMatchConflictError('Finish or discard the current match before making the next one.');
    }
    throw error;
  }
  return data as number[];
}

/** Replaces a scrim match's lineup (`set_scrim_match_lineup()`, one transaction). */
export async function setScrimMatchLineup(db: SupabaseClient, matchId: number, teams: ScrimTeams): Promise<void> {
  const { error } = await db.rpc('set_scrim_match_lineup', { p_match_id: matchId, p_shirts: teams.shirts, p_skins: teams.skins });
  if (error) throw error;
}

/** Sets a scrim match's map. */
export async function setScrimMatchMap(db: SupabaseClient, matchId: number, map: ScrimMap): Promise<void> {
  await db
    .from('matches')
    .update({ shirts_pick: map.name, scrim_workshop_id: map.workshopId })
    .eq('id', matchId)
    .not('scrim_night_id', 'is', null)
    .throwOnError();
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
