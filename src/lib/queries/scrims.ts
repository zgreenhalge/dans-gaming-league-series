import { cache } from 'react';
import { getAdminClient } from '../supabase-admin';
import {
  normalizeStartTime,
  scrimNightSlots,
  nextScrimNight,
  hasScrimNightStarted,
  isScrimCheckInOpen,
  zonedTimeToUtc,
  type ScrimCommitment,
  type ScrimNightRow,
  type ScrimNightSlot,
  type ScrimSchedule,
} from '../scrim-schedule';
import { persistentQuery } from './_persistentCache';
import { getPlayersById } from './player';
import { aggregatePlayerStats, type PlayerAggregateRow, type PlayerAggregateStats } from '../player-stats';
import { canonicalSortValues, isPlayedScore } from '../util';
import type { Player, PlayerMatchStat, RoundHistoryEntry } from '../types';
import { toMatchStatRows, type MatchStatRow } from './match';
import type { ScrimSideChoice } from '../scrim-matches';

export interface ScrimSignupEntry {
  player_id: number;
  player_name: string;
  steam_avatar_url: string | null;
  commitment: ScrimCommitment;
  signed_up_at: string;
  /** When they checked in on the night, or `null`. */
  checked_in_at: string | null;
}

/** The weekly scrim slot, or `null` before an admin has set one. */
export const getScrimSchedule = persistentQuery('getScrimSchedule', async (): Promise<ScrimSchedule | null> => {
  const { data, error } = await getAdminClient()
    .from('scrim_schedule')
    .select('weekday, start_time, timezone, enabled')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { weekday: number; start_time: string; timezone: string; enabled: boolean };
  return { weekday: row.weekday, startTime: normalizeStartTime(row.start_time), timezone: row.timezone, enabled: row.enabled };
});

/** Every `scrim_nights` row — one per date anyone has signed up for or an admin has cancelled. */
export const getScrimNightRows = persistentQuery('getScrimNightRows', async (): Promise<ScrimNightRow[]> => {
  const { data, error } = await getAdminClient().from('scrim_nights').select('id, night_date, cancelled');
  if (error) throw error;
  return (data ?? []) as ScrimNightRow[];
});

/** A night's signups: definite before maybe, then in signup order. A signup whose player row is
 *  missing is omitted, as in `getSeasonRoster()`. */
export const getScrimSignups = persistentQuery('getScrimSignups', async (nightId: number): Promise<ScrimSignupEntry[]> => {
  const [{ data, error }, playersById] = await Promise.all([
    getAdminClient().from('scrim_signups').select('player_id, commitment, signed_up_at, checked_in_at').eq('night_id', nightId),
    getPlayersById(),
  ]);
  if (error) throw error;

  const entries: ScrimSignupEntry[] = [];
  for (const r of (data ?? []) as { player_id: number; commitment: ScrimCommitment; signed_up_at: string; checked_in_at: string | null }[]) {
    const player = playersById.get(r.player_id);
    if (!player) continue;
    entries.push({ ...r, player_name: player.name, steam_avatar_url: player.steam_avatar_url });
  }
  const rank = (c: ScrimCommitment) => (c === 'definite' ? 0 : 1);
  return entries.sort((a, b) => rank(a.commitment) - rank(b.commitment) || a.signed_up_at.localeCompare(b.signed_up_at));
});

/** The schedule and the nights that haven't ended yet (`scrimNightSlots()`) as of `now`. */
export async function getScrimNights(now: Date): Promise<{ schedule: ScrimSchedule | null; slots: ScrimNightSlot[] }> {
  const [schedule, rows] = await Promise.all([getScrimSchedule(), getScrimNightRows()]);
  return { schedule, slots: scrimNightSlots(schedule, rows, now) };
}

export interface ScrimOverview {
  schedule: ScrimSchedule | null;
  /** Nights that haven't ended yet, cancelled ones included. */
  slots: ScrimNightSlot[];
  /** The next night that isn't cancelled. */
  next: ScrimNightSlot | null;
  /** Whether `next` has started. */
  started: boolean;
  /** Whether players can check in to `next` (`isScrimCheckInOpen()`). */
  checkInOpen: boolean;
  /** `next`'s signups (empty while it has no `scrim_nights` row). */
  signups: ScrimSignupEntry[];
}

/** Everything the scrims page and the home page's Next Scrims card show, as of `now`. */
export async function getScrimOverview(now: Date): Promise<ScrimOverview> {
  const { schedule, slots } = await getScrimNights(now);
  const next = nextScrimNight(slots);
  const signups = next?.nightId != null ? await getScrimSignups(next.nightId) : [];
  return {
    schedule,
    slots,
    next,
    started: next != null && hasScrimNightStarted(next, now),
    checkInOpen: next != null && isScrimCheckInOpen(next, now),
    signups,
  };
}

/** One player's line in a scrim match — zeroed until the match is scored. */
export interface ScrimMatchPlayer {
  player_id: number;
  faction: 'SHIRTS' | 'SKINS';
  kills: number;
  assists: number;
  deaths: number;
  damage: number;
  adr: number;
  rounds_played: number;
  rounds_won: number;
  is_win: boolean;
}

export interface ScrimMatch {
  id: number;
  night_id: number;
  match_number: number;
  /** The match's map (`shirts_pick`), chosen in the lobby. */
  map: string | null;
  /** The lobby's starting-side choice; it becomes `skins_starting_side` as the match starts. */
  side_choice: ScrimSideChoice;
  shirts: [number, number];
  skins: [number, number];
  players: ScrimMatchPlayer[];
  final_score: string | null;
  /** `match_server_state.server_state`, or `null` before the match was ever started. */
  server_state: string | null;
}

const SCRIM_MATCH_COLUMNS =
  'id, scrim_night_id, match_number, shirts_pick, scrim_side_choice, final_score, ' +
  'player_match_stats(player_id, faction, kills, assists, deaths, damage, adr, rounds_played, rounds_won, is_win), ' +
  'match_server_state(server_state)';

interface ScrimMatchRow {
  id: number;
  scrim_night_id: number;
  match_number: number;
  shirts_pick: string | null;
  scrim_side_choice: ScrimSideChoice;
  final_score: string | null;
  player_match_stats: ScrimMatchPlayer[] | null;
  match_server_state: { server_state: string } | { server_state: string }[] | null;
}

function toScrimMatch(r: ScrimMatchRow): ScrimMatch {
  const players = r.player_match_stats ?? [];
  const state = Array.isArray(r.match_server_state) ? r.match_server_state[0] : r.match_server_state;
  const side = (faction: 'SHIRTS' | 'SKINS') => players.filter((p) => p.faction === faction).map((p) => p.player_id) as [number, number];
  return {
    id: r.id,
    night_id: r.scrim_night_id,
    match_number: r.match_number,
    map: r.shirts_pick,
    side_choice: r.scrim_side_choice,
    shirts: side('SHIRTS'),
    skins: side('SKINS'),
    players,
    final_score: r.final_score,
    server_state: state?.server_state ?? null,
  };
}

/** A scrim night's matches in play order, with lineups, stat lines and server state. Not cached:
 *  server state is operational and changes without bumping `data_version`. */
export async function getScrimNightMatches(nightId: number): Promise<ScrimMatch[]> {
  const { data, error } = await getAdminClient().from('matches').select(SCRIM_MATCH_COLUMNS).eq('scrim_night_id', nightId).order('match_number');
  if (error) throw error;
  return ((data ?? []) as unknown as ScrimMatchRow[]).map(toScrimMatch);
}

/** One scrim match, as `getScrimNightMatches()` returns it, or `null` for a league match. */
export async function getScrimMatch(matchId: number): Promise<ScrimMatch | null> {
  const { data, error } = await getAdminClient()
    .from('matches')
    .select(SCRIM_MATCH_COLUMNS)
    .eq('id', matchId)
    .not('scrim_night_id', 'is', null)
    .maybeSingle();
  if (error) throw error;
  return data ? toScrimMatch(data as unknown as ScrimMatchRow) : null;
}

export interface ScrimLeaderboardRow extends PlayerAggregateStats {
  player_id: number;
  player_name: string;
  steam_avatar_url: string | null;
}

/** A night's standings from its scored matches, ranked the league's way (Wins → RWR% → ADR,
 *  `canonicalSortValues()`). Each player's totals come from `aggregatePlayerStats()`, the same sums
 *  every league leaderboard uses. */
export function buildScrimNightLeaderboard(matches: ScrimMatch[], playersById: Map<number, Pick<Player, 'name' | 'steam_avatar_url'>>): ScrimLeaderboardRow[] {
  const rowsByPlayer = new Map<number, PlayerAggregateRow[]>();
  for (const m of matches) {
    for (const p of m.players) {
      const rows = rowsByPlayer.get(p.player_id) ?? [];
      rows.push({ ...p, final_score: m.final_score, map: m.map });
      rowsByPlayer.set(p.player_id, rows);
    }
  }
  const out: ScrimLeaderboardRow[] = [];
  for (const [playerId, rows] of rowsByPlayer) {
    const totals = aggregatePlayerStats(rows);
    if (totals.matches === 0) continue;
    const player = playersById.get(playerId);
    out.push({ ...totals, player_id: playerId, player_name: player?.name ?? `#${playerId}`, steam_avatar_url: player?.steam_avatar_url ?? null });
  }
  return out.sort(canonicalSortValues);
}

export interface ScrimNightView {
  date: string;
  /** When the night starts, from the schedule — `null` if no schedule is set. */
  startsAt: string | null;
  nightId: number | null;
  cancelled: boolean;
  /** Still listed by `scrimNightSlots()`: upcoming or running, as opposed to over. */
  current: boolean;
  started: boolean;
  checkInOpen: boolean;
  signups: ScrimSignupEntry[];
  matches: ScrimMatch[];
  leaderboard: ScrimLeaderboardRow[];
}

/** Everything a night's page shows, or `null` for a date that is neither an upcoming night nor one
 *  with a `scrim_nights` row. */
export async function getScrimNight(date: string, now: Date): Promise<ScrimNightView | null> {
  const [{ schedule, slots }, rows, playersById] = await Promise.all([getScrimNights(now), getScrimNightRows(), getPlayersById()]);
  const slot = slots.find((s) => s.date === date);
  const row = rows.find((r) => r.night_date === date);
  if (!slot && !row) return null;

  const nightId = slot?.nightId ?? row?.id ?? null;
  const [signups, matches] = nightId != null
    ? await Promise.all([getScrimSignups(nightId), getScrimNightMatches(nightId)])
    : [[], []];
  const startsAt = slot?.startsAt ?? (schedule ? zonedTimeToUtc(date, schedule.startTime, schedule.timezone).toISOString() : null);
  return {
    date,
    startsAt,
    nightId,
    cancelled: slot?.cancelled ?? row?.cancelled ?? false,
    current: slot != null,
    started: slot != null && hasScrimNightStarted(slot, now),
    checkInOpen: slot != null && isScrimCheckInOpen(slot, now),
    signups,
    matches,
    leaderboard: buildScrimNightLeaderboard(matches, playersById),
  };
}

export interface PastScrimNight {
  date: string;
  /** Scored matches. */
  matches: number;
  /** Distinct players across those matches. */
  players: number;
}

/** Nights that are over and had at least one scored match, newest first. */
export async function getPastScrimNights(now: Date): Promise<PastScrimNight[]> {
  const [{ slots }, rows, { data, error }] = await Promise.all([
    getScrimNights(now),
    getScrimNightRows(),
    getAdminClient().from('matches').select('scrim_night_id, final_score, player_match_stats(player_id)').not('scrim_night_id', 'is', null),
  ]);
  if (error) throw error;
  const listed = new Set(slots.map((s) => s.date));
  const byNight = new Map<number, { matches: number; players: Set<number> }>();
  for (const m of (data ?? []) as unknown as { scrim_night_id: number; final_score: string | null; player_match_stats: { player_id: number }[] | null }[]) {
    if (!isPlayedScore(m.final_score)) continue;
    const entry = byNight.get(m.scrim_night_id) ?? { matches: 0, players: new Set<number>() };
    entry.matches++;
    for (const p of m.player_match_stats ?? []) entry.players.add(p.player_id);
    byNight.set(m.scrim_night_id, entry);
  }
  return rows
    .filter((r) => !listed.has(r.night_date) && byNight.has(r.id))
    .map((r) => ({ date: r.night_date, matches: byNight.get(r.id)!.matches, players: byNight.get(r.id)!.players.size }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface ScrimMatchDetail {
  id: number;
  match_number: number;
  night_date: string;
  final_score: string | null;
  shirts_pick: string | null;
  skins_pick: string | null;
  skins_starting_side: 'CT' | 'T' | null;
  round_history: RoundHistoryEntry[] | null;
  recording_url: string | null;
  stats: MatchStatRow[];
}

/** A scrim match's page data — the `getMatch()` counterpart for a match with no week — or `null`
 *  for a match that isn't a scrim match. `cache()`-wrapped so the page and its metadata share one read. */
export const getScrimMatchDetail = cache(async (matchId: number): Promise<ScrimMatchDetail | null> => {
  const [{ data, error }, playersById] = await Promise.all([
    getAdminClient()
      .from('matches')
      .select('id, match_number, final_score, shirts_pick, skins_pick, skins_starting_side, round_history, recording_url, scrim_nights(night_date), player_match_stats(*)')
      .eq('id', matchId)
      .not('scrim_night_id', 'is', null)
      .maybeSingle(),
    getPlayersById(),
  ]);
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as Omit<ScrimMatchDetail, 'night_date' | 'stats'> & {
    scrim_nights: { night_date: string } | null;
    player_match_stats: PlayerMatchStat[] | null;
  };
  const { scrim_nights, player_match_stats, ...match } = row;
  return {
    ...match,
    night_date: scrim_nights?.night_date ?? '',
    stats: toMatchStatRows(player_match_stats ?? [], playersById),
  };
});
