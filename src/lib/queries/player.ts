import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient } from '../supabase-admin';
import type { Player, Season, Match, PlayerMatchStat, ReplayStatus } from '../types';
import { extractSeasonNumber, compareMatchRefDesc, isPlayedScore } from '../util';
import type { RosterStat } from './schedule';
import { getAllSeasonMedalists, type TrophyEntry } from './trophies';
import { asPage, fetchAllPages, getWeekLookup, resolveMatchSeasons } from './_shared';
import { getSeasons } from './seasons';
import type { PlayerSeasonAdrTotal } from '../h2h';
import { effectivePickedMap } from '../veto';
import { persistentQuery } from './_persistentCache';


export interface PlayerHistoryRow extends PlayerMatchStat {
  match_number: number;
  week_number: number;
  season_id: number;
  season_number: number | null;
  season_name: string;
  is_gauntlet: boolean;
  map: string | null;
  final_score: string | null;
  pre_match_win_prob: number | null;
  scheduled_at: string | null;
  shirts: { player_id: number; player_name: string }[];
  skins: { player_id: number; player_name: string }[];
  shirts_stats: RosterStat[];
  skins_stats: RosterStat[];
  skins_pick: string | null;
  shirts_pick: string | null;
  skins_starting_side: 'CT' | 'T' | null;
  shirts_ban: string | null;
  shirts_ban2: string | null;
  skins_ban1: string | null;
  skins_ban2: string | null;
  is_playoff_game: boolean;
  /** This match's season's regular-season map pool. `null` for gauntlet seasons. */
  map_pool: string[] | null;
  /** `'ready'` once this match has a generated 2D replay — gates the Pathing tab. */
  replay_status: ReplayStatus | null;
}

export interface PlayerDetail {
  player: Player;
  history: PlayerHistoryRow[];
  trophies: TrophyEntry[];
}

export interface PlayerNameChange {
  old_name: string;
  new_name: string;
  changed_at: string;
}

/** A player's past renames, most recent first. Empty for a player who has never renamed. */
export const getPlayerNameHistory = persistentQuery('getPlayerNameHistory', async (playerId: number): Promise<PlayerNameChange[]> => {
  const { data, error } = await getAdminClient()
    .from('player_name_history')
    .select('old_name, new_name, changed_at')
    .eq('player_id', playerId)
    .order('changed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PlayerNameChange[];
});

/** Optional `client` per docs/recipes.md's query-helper recipe. Wrapped in `persistentQuery()`
 *  so every default-`client` caller shares one `players` table read instead of each doing its own
 *  full-table fetch; a call that passes a `client` (a script, a non-request context) reads straight
 *  from the database. */
export const getPlayersById = persistentQuery('getPlayersById', async (client?: SupabaseClient): Promise<Map<number, Player>> => {
  const db = client ?? getAdminClient();
  const { data, error } = await db.from('players').select('*');
  if (error) throw error;
  const map = new Map<number, Player>();
  for (const p of (data ?? []) as Player[]) map.set(p.id, p);
  return map;
});

/** `players` keyed by Steam ID (`players.steam_id`) instead of the internal id, scoped to just
 *  `steamIds` — for a caller matching a small, known set of players by the game server's own
 *  identifier (MatchZy's live remote-log events, e.g.) rather than a DB-known roster. A dedicated
 *  filtered query rather than `getPlayersById()`'s whole-table read: that function's callers each run
 *  once per page load / per finished match, but this one backs a live match's `round_end` handling,
 *  which repeats every round — scoping the read keeps that from scaling with the size of the players
 *  table. Empty for an empty `steamIds`, without a round trip. */
export async function getPlayersBySteamId(steamIds: string[], client?: SupabaseClient): Promise<Map<string, Player>> {
  const db = client ?? getAdminClient();
  const map = new Map<string, Player>();
  if (steamIds.length === 0) return map;
  const { data, error } = await db.from('players').select('*').in('steam_id', steamIds);
  if (error) throw error;
  for (const p of (data ?? []) as Player[]) {
    if (p.steam_id) map.set(p.steam_id, p);
  }
  return map;
}

/** Resolves a linked Discord user id (`players.discord_id`) to its player row — the "me" lookup
 *  behind Discord slash commands (#396). `null` for an unlinked/unknown id. */
export async function getPlayerByDiscordId(discordId: string): Promise<Player | null> {
  const { data, error } = await getAdminClient().from('players').select('*').eq('discord_id', discordId).maybeSingle();
  if (error) throw error;
  return (data ?? null) as Player | null;
}

/** Case-insensitive exact name match — `players_name_lower_unique` guarantees at most one row, so
 *  this is a lookup, not a search. Used by Discord slash commands (#396) resolving a typed player
 *  name rather than an argument-less "me". Filters client-side over `getPlayersById()` rather than
 *  a server-side `ilike`, same "the whole table is cheap" reasoning `getPlayersById()` itself
 *  already relies on. */
export async function findPlayerByName(name: string): Promise<Player | null> {
  const target = name.toLowerCase();
  const players = await getPlayersById();
  for (const player of players.values()) {
    if (player.name.toLowerCase() === target) return player;
  }
  return null;
}

/** The roster columns `player_match_stats` rows carry, as read for every player in a match. */
type RosterStatRow = {
  match_id: number;
  player_id: number;
  faction: 'SHIRTS' | 'SKINS';
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  is_win: boolean;
  rounds_won: number;
  rounds_played: number;
};

type HistoryRoster = Pick<PlayerHistoryRow, 'shirts' | 'skins' | 'shirts_stats' | 'skins_stats'>;
/** A history row before its roster is attached. */
type HistoryBase = Omit<PlayerHistoryRow, keyof HistoryRoster>;

/** `rows` with `shirts` / `skins` / `shirts_stats` / `skins_stats` filled in from the full
 *  `player_match_stats` of just those rows' matches. */
async function attachRosters<T extends { match_id: number }>(rows: T[]): Promise<(T & HistoryRoster)[]> {
  if (rows.length === 0) return [];
  const matchIds = Array.from(new Set(rows.map((r) => r.match_id)));
  const [{ data: allStats, error: aErr }, players] = await Promise.all([
    getAdminClient().from('player_match_stats').select('*').in('match_id', matchIds),
    getPlayersById(),
  ]);
  if (aErr) throw aErr;

  const rosterByMatch = new Map<
    number,
    { shirts: { player_id: number; player_name: string }[]; skins: { player_id: number; player_name: string }[]; shirts_stats?: RosterStatRow[]; skins_stats?: RosterStatRow[] }
  >();
  for (const st of (allStats ?? []) as RosterStatRow[]) {
    const entry = rosterByMatch.get(st.match_id) ?? { shirts: [], skins: [] };
    const p = players.get(st.player_id);
    const slot = {
      player_id: st.player_id,
      player_name: p?.name ?? `#${st.player_id}`,
    };

    const statObj = {
      match_id: st.match_id,
      player_id: st.player_id,
      player_name: p?.name ?? `#${st.player_id}`,
      faction: st.faction,
      kills: st.kills,
      assists: st.assists ?? 0,
      deaths: st.deaths,
      adr: st.adr ?? 0,
      is_win: !!st.is_win,
      rounds_won: st.rounds_won,
      rounds_played: st.rounds_played,
    };

    if (st.faction === 'SHIRTS') {
      entry.shirts.push(slot);
      entry.shirts_stats = (entry.shirts_stats ?? []).concat(statObj);
    } else {
      entry.skins.push(slot);
      entry.skins_stats = (entry.skins_stats ?? []).concat(statObj);
    }
    rosterByMatch.set(st.match_id, entry);
  }

  return rows.map((row) => {
    const roster = rosterByMatch.get(row.match_id);
    return {
      ...row,
      shirts: roster?.shirts ?? [],
      skins: roster?.skins ?? [],
      shirts_stats: (roster?.shirts_stats ?? []) as RosterStat[],
      skins_stats: (roster?.skins_stats ?? []) as RosterStat[],
    };
  });
}

type WeekLookup = Awaited<ReturnType<typeof getWeekLookup>>;

/** All of a player's `player_match_stats` rows, narrowed to `columns`. */
function fetchPlayerStatRows<T>(playerId: number, columns: string): Promise<T[]> {
  return fetchAllPages<T>((from, to) =>
    asPage(getAdminClient().from('player_match_stats').select(columns).eq('player_id', playerId).range(from, to)),
  );
}

/** The seasons that `matches` (through their weeks) belong to. */
async function fetchSeasonsOf(matches: { week_id: number }[], weekLookup: WeekLookup): Promise<Map<number, Season>> {
  const seasonIds = Array.from(
    new Set(matches.map((m) => weekLookup.get(m.week_id)?.season_id).filter((id): id is number => id != null)),
  );
  const { data, error } = await getAdminClient().from('seasons').select('*').in('id', seasonIds);
  if (error) throw error;
  return new Map(((data ?? []) as Season[]).map((se) => [se.id, se]));
}

/** `weekId`'s week number and season, or `null` when either is missing. */
function placeInLeague(weekId: number, weekLookup: WeekLookup, seasonById: Map<number, Season>) {
  const w = weekLookup.get(weekId);
  const season = w && seasonById.get(w.season_id);
  return w && season ? { week_number: w.week_number, season } : null;
}

/** `rows` sorted newest first (in place): season (numbered before gauntlet), then week, then match. */
function newestFirst<T extends { season_name: string; is_gauntlet: boolean; week_number: number; match_number: number }>(
  rows: T[],
): T[] {
  const ref = (r: T) => ({
    seasonNumber: extractSeasonNumber(r.season_name),
    isGauntlet: r.is_gauntlet,
    weekNumber: r.week_number,
    matchNumber: r.match_number,
  });
  return rows.sort((a, b) => compareMatchRefDesc(ref(a), ref(b)));
}

/** A player's `statRows` joined to their `matches`, weeks and seasons, newest first, before rosters
 *  (`attachRosters()`) are attached. A stat row whose match, week or season is missing is dropped. */
function toHistory(
  statRows: PlayerMatchStat[],
  matches: Match[],
  weekLookup: WeekLookup,
  seasonById: Map<number, Season>,
): HistoryBase[] {
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const rows: HistoryBase[] = [];
  for (const s of statRows) {
    const m = matchById.get(s.match_id);
    const placed = m && placeInLeague(m.week_id, weekLookup, seasonById);
    if (!m || !placed) continue;
    const se = placed.season;
    rows.push({
      ...s,
      match_number: m.match_number,
      week_number: placed.week_number,
      season_id: se.id,
      season_number: extractSeasonNumber(se.name),
      season_name: se.name,
      is_gauntlet: se.is_gauntlet,
      map: effectivePickedMap(m),
      final_score: m.final_score,
      pre_match_win_prob: m.pre_match_win_prob,
      scheduled_at: m.scheduled_at,
      skins_pick: m.skins_pick,
      shirts_pick: m.shirts_pick,
      skins_starting_side: m.skins_starting_side,
      shirts_ban: m.shirts_ban,
      shirts_ban2: m.shirts_ban2,
      skins_ban1: m.skins_ban1,
      skins_ban2: m.skins_ban2,
      is_playoff_game: m.is_playoff_game,
      map_pool: se.is_gauntlet ? null : se.map_pool,
      replay_status: m.replay_status ?? null,
    });
  }
  return newestFirst(rows);
}

/** A player's match history, newest first, before rosters (`attachRosters()`) are attached. */
async function loadPlayerHistory(playerId: number): Promise<HistoryBase[]> {
  const statRows = await fetchPlayerStatRows<PlayerMatchStat>(playerId, '*');
  if (statRows.length === 0) return [];

  const matchIds = Array.from(new Set(statRows.map((s) => s.match_id)));
  const [{ data: matches, error: mErr }, weekLookup] = await Promise.all([
    getAdminClient().from('matches').select('*').in('id', matchIds),
    getWeekLookup(),
  ]);
  if (mErr) throw mErr;
  const seasonById = await fetchSeasonsOf((matches ?? []) as Match[], weekLookup);
  return toHistory(statRows, (matches ?? []) as Match[], weekLookup, seasonById);
}

/**
 * The rows of `loadPlayerHistory()` that `pickRecent(history, recentLimit)` keeps, newest first,
 * before rosters are attached. Placing a match in the timeline needs only its score, week and
 * season, so every match is read as just those columns (and the player's stat rows as just
 * `match_id` and `rounds_played`); the full stat and match rows are read for the picked matches
 * alone. Season, week and match numbers are not columns of `player_match_stats`, and the season
 * number is parsed from its name, so the ordering cannot be pushed into a single `order` + `limit`.
 */
async function loadPlayerRecentHistory(playerId: number, recentLimit: number): Promise<HistoryBase[]> {
  const stats = await fetchPlayerStatRows<Pick<PlayerMatchStat, 'match_id' | 'rounds_played'>>(
    playerId,
    'match_id, rounds_played',
  );
  if (stats.length === 0) return [];

  const matchIds = Array.from(new Set(stats.map((s) => s.match_id)));
  const [{ data: placedRows, error: pErr }, weekLookup] = await Promise.all([
    getAdminClient().from('matches').select('id, week_id, match_number, final_score').in('id', matchIds),
    getWeekLookup(),
  ]);
  if (pErr) throw pErr;
  const placedMatches = (placedRows ?? []) as Pick<Match, 'id' | 'week_id' | 'match_number' | 'final_score'>[];
  const seasonById = await fetchSeasonsOf(placedMatches, weekLookup);

  const placedById = new Map(placedMatches.map((m) => [m.id, m]));
  const timeline = newestFirst(
    stats.flatMap((s) => {
      const m = placedById.get(s.match_id);
      const placed = m && placeInLeague(m.week_id, weekLookup, seasonById);
      if (!m || !placed) return [];
      return [{
        match_id: s.match_id,
        rounds_played: s.rounds_played,
        final_score: m.final_score,
        match_number: m.match_number,
        week_number: placed.week_number,
        season_name: placed.season.name,
        is_gauntlet: placed.season.is_gauntlet,
      }];
    }),
  );
  const pickedIds = pickRecent(timeline, recentLimit).map((r) => r.match_id);
  if (pickedIds.length === 0) return [];

  const [{ data: statRows, error: sErr }, { data: matches, error: mErr }] = await Promise.all([
    getAdminClient().from('player_match_stats').select('*').eq('player_id', playerId).in('match_id', pickedIds),
    getAdminClient().from('matches').select('*').in('id', pickedIds),
  ]);
  if (sErr) throw sErr;
  if (mErr) throw mErr;
  return toHistory((statRows ?? []) as PlayerMatchStat[], (matches ?? []) as Match[], weekLookup, seasonById);
}

export const getPlayer = persistentQuery('getPlayer', async (playerId: number): Promise<PlayerDetail | null> => {
  const player = (await getPlayersById()).get(playerId);
  if (!player) return null;
  const [history, medalists] = await Promise.all([
    loadPlayerHistory(playerId).then(attachRosters),
    getAllSeasonMedalists(),
  ]);
  return { player, history, trophies: medalists.get(playerId) ?? [] };
});

/**
 * Every player's played games and summed per-match ADR, one row per player per season, from the
 * played matches with rounds played (the rows `isPlayedHistoryRow()` keeps). The player page sums
 * these under its season selection (`adrBaselineFor()`, `src/lib/h2h.ts`) into the league-wide
 * baseline `computeH2H()` measures a partner's ADR lift against, since the page holds only the viewed
 * player's own matches.
 */
export const getPlayerSeasonAdrTotals = persistentQuery('getPlayerSeasonAdrTotals', async (): Promise<PlayerSeasonAdrTotal[]> => {
  const [matchSeason, seasons, statRows] = await Promise.all([
    resolveMatchSeasons(),
    getSeasons(),
    fetchAllPages<Pick<PlayerMatchStat, 'match_id' | 'player_id' | 'adr' | 'rounds_played'>>((from, to) =>
      asPage(getAdminClient().from('player_match_stats').select('match_id, player_id, adr, rounds_played').range(from, to)),
    ),
  ]);
  const gauntletSeasonIds = new Set(seasons.filter((s) => s.is_gauntlet).map((s) => s.id));
  const totals = new Map<string, PlayerSeasonAdrTotal>();
  for (const r of statRows) {
    const seasonId = matchSeason.get(r.match_id);
    if (seasonId == null || !(r.rounds_played > 0)) continue;
    const key = `${r.player_id}:${seasonId}`;
    const total = totals.get(key) ?? { player_id: r.player_id, season_id: seasonId, is_gauntlet: gauntletSeasonIds.has(seasonId), games: 0, adr_sum: 0 };
    total.games += 1;
    total.adr_sum += r.adr ?? 0;
    totals.set(key, total);
  }
  return [...totals.values()].sort((a, b) => a.player_id - b.player_id || a.season_id - b.season_id);
});

/** The rows of `history` (newest first) that `lastPlayed(history, limit)` and `nextUpcoming(history)`
 *  pick, still newest first. */
export function pickRecent<T extends HistoryResult>(history: T[], limit: number): T[] {
  const next = nextUpcoming(history);
  const keep = new Set([...lastPlayed(history, limit), ...(next ? [next] : [])]);
  return history.filter((r) => keep.has(r));
}

/**
 * The slice of `getPlayer()` the home page's My Stats panel and the player hover card read:
 * `player` plus a `history` of `pickRecent(history, recentLimit)` with rosters for just those
 * matches. Reads the full stat and match rows of those matches alone
 * (`loadPlayerRecentHistory()`) and skips the trophy read.
 * `null` when the player doesn't exist.
 */
export const getPlayerRecent = persistentQuery('getPlayerRecent', async (
  playerId: number,
  recentLimit: number,
): Promise<Pick<PlayerDetail, 'player' | 'history'> | null> => {
  const player = (await getPlayersById()).get(playerId);
  if (!player) return null;
  return { player, history: await attachRosters(await loadPlayerRecentHistory(playerId, recentLimit)) };
});

/** The fields that decide whether a history row's match has been played. */
type HistoryResult = Pick<PlayerHistoryRow, 'final_score' | 'rounds_played'>;

/** True for a history row whose match has a real result — the row counts toward the player's
 *  record, "Last 5" and match history. A `"0-0"` placeholder, an unscored match, or a row with no
 *  rounds played is upcoming instead. */
export function isPlayedHistoryRow(r: HistoryResult): boolean {
  return isPlayedScore(r.final_score) && r.rounds_played > 0;
}

/** The `limit` most recent played rows of `history` (which `getPlayer()` returns newest first) —
 *  the player page's "Last 5" and the home page's Match history. */
export function lastPlayed<T extends HistoryResult>(history: T[], limit: number): T[] {
  return history.filter(isPlayedHistoryRow).slice(0, limit);
}

/** The earliest not-yet-played row of `history` (`getPlayer()` returns it newest first) — the home
 *  page's Next Match, and the player page's too. `null` when nothing is upcoming. */
export function nextUpcoming<T extends HistoryResult>(history: T[]): T | null {
  const upcoming = history.filter((r) => !isPlayedHistoryRow(r));
  return upcoming.length > 0 ? upcoming[upcoming.length - 1] : null;
}

/** The names of the other team in a history row's match, "A & B" — `TBD` while it has no roster. */
export function opponentNames(row: PlayerHistoryRow): string {
  const opponents = row.faction === 'SHIRTS' ? row.skins : row.shirts;
  return opponents.map((p) => p.player_name).join(' & ') || 'TBD';
}
