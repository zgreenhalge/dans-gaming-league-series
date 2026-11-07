import { cache } from 'react';
import { getAdminClient } from '../supabase-admin';
import {
  hasScrimNightEnded,
  hasScrimNightStarted,
  isScrimCheckInOpen,
  upcomingScrimNights,
  type ScrimCommitment,
  type ScrimNight,
} from '../scrim-schedule';
import { persistentQuery } from './_persistentCache';
import { asPage, fetchAllPages } from './_shared';
import { getPlayersById } from './player';
import { computeH2H, scrimMatchesToH2HInput, type H2HData } from '../h2h';
import { aggregatePlayerStats, type PlayerAggregateRow, type PlayerAggregateStats } from '../player-stats';
import { canonicalSortValues, isPlayedScore } from '../util';
import type { LeaderboardStatLine, Player, PlayerMatchStat, RoundHistoryEntry } from '../types';
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

/** Every scrim night, in no particular order. */
export const getScrimNightRows = persistentQuery('getScrimNightRows', async (): Promise<ScrimNight[]> => {
  const { data, error } = await getAdminClient().from('scrim_nights').select('id, starts_at');
  if (error) throw error;
  return ((data ?? []) as { id: number; starts_at: string }[]).map((r) => ({ id: r.id, startsAt: new Date(r.starts_at).toISOString() }));
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

/** A night that hasn't ended, with what its signup panel shows. */
export interface UpcomingScrimNight {
  night: ScrimNight;
  started: boolean;
  /** Whether players can check in (`isScrimCheckInOpen()`). */
  checkInOpen: boolean;
  signups: ScrimSignupEntry[];
}

/** The nights that haven't ended as of `now`, soonest first, with their signups — what the scrims
 *  calendar shows. */
export async function getUpcomingScrimNights(now: Date): Promise<UpcomingScrimNight[]> {
  const nights = upcomingScrimNights(await getScrimNightRows(), now);
  const signups = await Promise.all(nights.map((n) => getScrimSignups(n.id)));
  return nights.map((night, i) => toUpcomingScrimNight(night, signups[i], now));
}

function toUpcomingScrimNight(night: ScrimNight, signups: ScrimSignupEntry[], now: Date): UpcomingScrimNight {
  return { night, started: hasScrimNightStarted(night, now), checkInOpen: isScrimCheckInOpen(night, now), signups };
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
  /** The workshop item the server loads for it (`scrim_workshop_id`). */
  workshop_id: string | null;
  /** The lobby's starting-side choice; it becomes `skins_starting_side` as the match starts. */
  side_choice: ScrimSideChoice;
  /** The side SKINS started on, once the match has started with a side (none for a knife round). */
  skins_starting_side: 'CT' | 'T' | null;
  shirts: [number, number];
  skins: [number, number];
  players: ScrimMatchPlayer[];
  final_score: string | null;
  /** `match_server_state.server_state`, or `null` before the match was ever started. */
  server_state: string | null;
}

const SCRIM_MATCH_COLUMNS =
  'id, scrim_night_id, match_number, shirts_pick, scrim_workshop_id, scrim_side_choice, skins_starting_side, final_score, ' +
  'player_match_stats(player_id, faction, kills, assists, deaths, damage, adr, rounds_played, rounds_won, is_win), ' +
  'match_server_state(server_state)';

interface ScrimMatchRow {
  id: number;
  scrim_night_id: number;
  match_number: number;
  shirts_pick: string | null;
  scrim_workshop_id: string | null;
  scrim_side_choice: ScrimSideChoice;
  skins_starting_side: 'CT' | 'T' | null;
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
    workshop_id: r.scrim_workshop_id,
    side_choice: r.scrim_side_choice,
    skins_starting_side: r.skins_starting_side,
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

/** A night's standings as the Stats tables' rows (`BasicStatsView`), in the same order. */
export function scrimLeaderboardToStatLines(rows: ScrimLeaderboardRow[]): LeaderboardStatLine[] {
  return rows.map((r) => ({
    player_id: r.player_id,
    player_name: r.player_name,
    steam_avatar_url: r.steam_avatar_url,
    matches_played: r.matches,
    matches_won: r.wins,
    matches_lost: r.losses,
    win_rate_percentage: r.wr,
    total_kills: r.kills,
    total_assists: r.assists,
    total_deaths: r.deaths,
    kd_ratio: r.kd,
    total_damage: r.damage,
    total_rounds_played: r.rounds_played,
    total_rounds_won: r.rounds_won,
    rwr_percentage: r.rwr,
    overall_adr: r.adr,
    kills_in_wins: r.kills_in_wins,
    deaths_in_wins: r.deaths_in_wins,
    kills_in_losses: r.kills_in_losses,
    deaths_in_losses: r.deaths_in_losses,
  }));
}

export interface ScrimNightView extends UpcomingScrimNight {
  /** Not yet ended: upcoming or running, as opposed to over. */
  current: boolean;
  matches: ScrimMatch[];
  leaderboard: ScrimLeaderboardRow[];
  /** The night's partner and opponent records (`computeH2H()` over its scored matches). */
  h2h: H2HData;
}

/** The night with id `nightId`, or `null`. */
export async function getScrimNightById(nightId: number): Promise<ScrimNight | null> {
  return (await getScrimNightRows()).find((n) => n.id === nightId) ?? null;
}

/** Everything a night's page shows, or `null` for an id with no night. */
export async function getScrimNight(nightId: number, now: Date): Promise<ScrimNightView | null> {
  const [night, playersById] = await Promise.all([getScrimNightById(nightId), getPlayersById()]);
  if (!night) return null;
  const [signups, matches] = await Promise.all([getScrimSignups(night.id), getScrimNightMatches(night.id)]);
  return {
    ...toUpcomingScrimNight(night, signups, now),
    current: !hasScrimNightEnded(night, now),
    matches,
    leaderboard: buildScrimNightLeaderboard(matches, playersById),
    h2h: computeH2H(scrimMatchesToH2HInput(matches), playersById),
  };
}

export interface PastScrimNight extends ScrimNight {
  /** Scored matches. */
  matches: number;
  /** Distinct players across those matches. */
  players: number;
}

/** Each night with a scored match: how many, and how many distinct players played them. */
const getScrimNightPlayCounts = persistentQuery('getScrimNightPlayCounts', async (): Promise<{ nightId: number; matches: number; players: number }[]> => {
  type MatchRow = { scrim_night_id: number; final_score: string | null; player_match_stats: { player_id: number }[] | null };
  const data = await fetchAllPages<MatchRow>((from, to) =>
    asPage(getAdminClient().from('matches').select('scrim_night_id, final_score, player_match_stats(player_id)').not('scrim_night_id', 'is', null).range(from, to)),
  );
  const byNight = new Map<number, { matches: number; players: Set<number> }>();
  for (const m of data) {
    if (!isPlayedScore(m.final_score)) continue;
    const entry = byNight.get(m.scrim_night_id) ?? { matches: 0, players: new Set<number>() };
    entry.matches++;
    for (const p of m.player_match_stats ?? []) entry.players.add(p.player_id);
    byNight.set(m.scrim_night_id, entry);
  }
  return [...byNight].map(([nightId, e]) => ({ nightId, matches: e.matches, players: e.players.size }));
});

/** Nights that are over and had at least one scored match, newest first. */
export async function getPastScrimNights(now: Date): Promise<PastScrimNight[]> {
  const [rows, counts] = await Promise.all([getScrimNightRows(), getScrimNightPlayCounts()]);
  const byNight = new Map(counts.map((c) => [c.nightId, c]));
  return rows
    .filter((r) => hasScrimNightEnded(r, now) && byNight.has(r.id))
    .map((r) => ({ ...r, matches: byNight.get(r.id)!.matches, players: byNight.get(r.id)!.players }))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

export interface ScrimMatchDetail {
  id: number;
  match_number: number;
  night_id: number;
  /** When the match's night starts. */
  night_starts_at: string;
  final_score: string | null;
  shirts_pick: string | null;
  skins_pick: string | null;
  skins_starting_side: 'CT' | 'T' | null;
  round_history: RoundHistoryEntry[] | null;
  ot_rounds_per_half: number | null;
  recording_url: string | null;
  stats: MatchStatRow[];
}

/** A scrim match's page data — the `getMatch()` counterpart for a match with no week — or `null`
 *  for a match that isn't a scrim match. `cache()`-wrapped so the page and its metadata share one read. */
export const getScrimMatchDetail = cache(async (matchId: number): Promise<ScrimMatchDetail | null> => {
  const [{ data, error }, playersById] = await Promise.all([
    getAdminClient()
      .from('matches')
      .select('id, match_number, final_score, shirts_pick, skins_pick, skins_starting_side, round_history, ot_rounds_per_half, recording_url, scrim_night_id, scrim_nights(starts_at), player_match_stats(*)')
      .eq('id', matchId)
      .not('scrim_night_id', 'is', null)
      .maybeSingle(),
    getPlayersById(),
  ]);
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as Omit<ScrimMatchDetail, 'night_id' | 'night_starts_at' | 'stats'> & {
    scrim_night_id: number;
    scrim_nights: { starts_at: string } | null;
    player_match_stats: PlayerMatchStat[] | null;
  };
  const { scrim_night_id, scrim_nights, player_match_stats, ...match } = row;
  return {
    ...match,
    night_id: scrim_night_id,
    night_starts_at: scrim_nights ? new Date(scrim_nights.starts_at).toISOString() : '',
    stats: toMatchStatRows(player_match_stats ?? [], playersById),
  };
});
