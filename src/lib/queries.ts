import { supabase } from './supabase';
import { isPlayedScore, winRatePct, avgOf } from './util';
import { mapSlug } from './maps';
import { extractSeasonNumber, buildRegularToGauntletMap, parseScore, canonicalSort, compareMatchRefDesc } from './util';
import { MU_DEFAULT, SIGMA_DEFAULT, DEFAULT_EHOG, correctedDelta } from './ehog';
import type {
  Season,
  Week,
  Match,
  Player,
  PlayerMatchStat,
  LeaderboardRow,
  LeaderboardRowWithId,
  MapIndexEntry,
  Faction,
} from './types';

export interface RosterStat {
  match_id: number;
  player_id: number;
  player_name: string;
  faction: Faction;
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  is_win: boolean;
}

export interface MatchWithRoster extends Match {
  shirts: { player_id: number; player_name: string }[];
  skins: { player_id: number; player_name: string }[];
  shirts_stats: RosterStat[];
  skins_stats: RosterStat[];
}

export interface WeekWithMatches extends Week {
  bye_player_name: string | null;
  matches: MatchWithRoster[];
}

export interface MatchStatRow extends PlayerMatchStat {
  player_name: string;
  steam_avatar_url: string | null;
}

export interface MatchDetail {
  match: Match;
  week: Week;
  season: Season;
  stats: MatchStatRow[];
}

export interface PlayerHistoryRow extends PlayerMatchStat {
  match_number: number;
  week_number: number;
  season_id: number;
  season_number: number | null;
  season_name: string;
  is_gauntlet: boolean;
  map: string | null;
  final_score: string | null;
  scheduled_at: string | null;
  shirts: { player_id: number; player_name: string }[];
  skins: { player_id: number; player_name: string }[];
  shirts_stats: RosterStat[];
  skins_stats: RosterStat[];
  picked_map: string | null;
  shirts_pick: string | null;
  skins_starting_side: 'CT' | 'T' | null;
  shirts_ban: string | null;
  shirts_ban2: string | null;
  skins_ban1: string | null;
  skins_ban2: string | null;
}

export interface PlayerDetail {
  player: Player;
  history: PlayerHistoryRow[];
  trophies: TrophyEntry[];
}

function n(v: number | null | undefined): number {
  return v == null ? 0 : v;
}

function normalizeRow(r: LeaderboardRow): LeaderboardRow {
  return {
    ...r,
    matches_played: n(r.matches_played),
    matches_won: n(r.matches_won),
    matches_lost: n(r.matches_lost),
    win_rate_percentage: n(r.win_rate_percentage),
    total_kills: n(r.total_kills),
    total_assists: n(r.total_assists),
    total_deaths: n(r.total_deaths),
    kd_ratio: n(r.kd_ratio),
    total_damage: n(r.total_damage),
    total_rounds_played: n(r.total_rounds_played),
    total_rounds_won: n(r.total_rounds_won),
    rwr_percentage: n(r.rwr_percentage),
    overall_adr: n(r.overall_adr),
  };
}

interface PerPlayerStats {
  assists: number;
  rounds_won: number;
  kills_in_wins: number;
  deaths_in_wins: number;
  kills_in_losses: number;
  deaths_in_losses: number;
}

/**
 * Aggregates assists and rounds_won from player_match_stats (both are absent
 * from the leaderboard view). Excludes playoff games. Returns a Map keyed by
 * `${season_id}:${player_id}`.
 */
/**
 * Fetches the three shared tables (weeks, matches, player_match_stats) once
 * and returns both derived outputs, replacing two back-to-back triple-fetches
 * with a single shared fetch.
 */
async function getSeasonBaseData(): Promise<{
  perPlayerStats: Map<string, PerPlayerStats>;
  rosterBySeason: Map<number, Set<number>>;
}> {
  const [
    { data: stats, error: sErr },
    { data: matches, error: mErr },
    { data: weeks, error: wErr },
  ] = await Promise.all([
    supabase.from('player_match_stats').select('player_id, assists, rounds_won, match_id, kills, deaths, is_win'),
    supabase.from('matches').select('id, week_id, is_playoff_game, final_score'),
    supabase.from('weeks').select('id, season_id'),
  ]);
  if (sErr) throw sErr;
  if (mErr) throw mErr;
  if (wErr) throw wErr;

  const weekToSeason = new Map<number, number>();
  for (const w of (weeks ?? []) as { id: number; season_id: number }[])
    weekToSeason.set(w.id, w.season_id);

  // played non-playoff matches → their season (for perPlayerStats)
  const playedMatchSeason = new Map<number, number>();
  // unplayed matches → their season (for rosterBySeason)
  const unplayedMatchSeason = new Map<number, number>();
  for (const m of (matches ?? []) as { id: number; week_id: number; is_playoff_game: boolean; final_score: string | null }[]) {
    const sid = weekToSeason.get(m.week_id);
    if (sid == null) continue;
    if (isPlayedScore(m.final_score) && !m.is_playoff_game) playedMatchSeason.set(m.id, sid);
    if (!isPlayedScore(m.final_score)) unplayedMatchSeason.set(m.id, sid);
  }

  const perPlayerStats = new Map<string, PerPlayerStats>();
  const rosterBySeason = new Map<number, Set<number>>();

  for (const s of (stats ?? []) as {
    player_id: number;
    assists: number | null;
    rounds_won: number | null;
    match_id: number;
    kills: number | null;
    deaths: number | null;
    is_win: boolean | null;
  }[]) {
    const playedSid = playedMatchSeason.get(s.match_id);
    if (playedSid != null) {
      const key = `${playedSid}:${s.player_id}`;
      const prev = perPlayerStats.get(key) ?? { assists: 0, rounds_won: 0, kills_in_wins: 0, deaths_in_wins: 0, kills_in_losses: 0, deaths_in_losses: 0 };
      const win = !!s.is_win;
      const k = s.kills ?? 0;
      const d = s.deaths ?? 0;
      perPlayerStats.set(key, {
        assists: prev.assists + (s.assists ?? 0),
        rounds_won: prev.rounds_won + (s.rounds_won ?? 0),
        kills_in_wins: prev.kills_in_wins + (win ? k : 0),
        deaths_in_wins: prev.deaths_in_wins + (win ? d : 0),
        kills_in_losses: prev.kills_in_losses + (win ? 0 : k),
        deaths_in_losses: prev.deaths_in_losses + (win ? 0 : d),
      });
    }

    const unplayedSid = unplayedMatchSeason.get(s.match_id);
    if (unplayedSid != null) {
      const set = rosterBySeason.get(unplayedSid) ?? new Set<number>();
      set.add(s.player_id);
      rosterBySeason.set(unplayedSid, set);
    }
  }

  return { perPlayerStats, rosterBySeason };
}

function zeroStatRows(
  seasonId: number,
  playerIds: Set<number>,
  playersById: Map<number, Player>,
): LeaderboardRowWithId[] {
  return [...playerIds].map((pid) => ({
    season_id: seasonId,
    player_id: pid,
    player_name: playersById.get(pid)?.name ?? `#${pid}`,
    matches_played: 0,
    matches_won: 0,
    matches_lost: 0,
    win_rate_percentage: 0,
    total_kills: 0,
    total_assists: 0,
    total_deaths: 0,
    kd_ratio: 0,
    total_damage: 0,
    total_rounds_played: 0,
    total_rounds_won: 0,
    rwr_percentage: 0,
    overall_adr: 0,
    kills_in_wins: 0,
    deaths_in_wins: 0,
    kills_in_losses: 0,
    deaths_in_losses: 0,
  }));
}

export async function getSeasons(): Promise<Season[]> {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .order('id');
  if (error) throw error;
  return (data ?? []) as Season[];
}

export async function getPlayersById(): Promise<Map<number, Player>> {
  const { data, error } = await supabase.from('players').select('*');
  if (error) throw error;
  const map = new Map<number, Player>();
  for (const p of (data ?? []) as Player[]) map.set(p.id, p);
  return map;
}

export async function getSeason(id: number): Promise<Season | null> {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Season | null;
}

/** Weeks + matches + per-match Shirts/Skins rosters (from player_match_stats). */
export async function getSeasonSchedule(
  seasonId: number,
): Promise<WeekWithMatches[]> {
  const [{ data: weeks, error: wErr }, players] = await Promise.all([
    supabase
      .from('weeks')
      .select('*')
      .eq('season_id', seasonId)
      .order('week_number'),
    getPlayersById(),
  ]);
  if (wErr) throw wErr;
  const weekRows = (weeks ?? []) as Week[];
  if (weekRows.length === 0) return [];

  const weekIds = weekRows.map((w) => w.id);
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('*')
    .in('week_id', weekIds)
    .order('match_number');
  if (mErr) throw mErr;
  const matchRows = (matches ?? []) as Match[];
  const matchIds = matchRows.map((m) => m.id);

  let stats: PlayerMatchStat[] = [];
  if (matchIds.length > 0) {
    const { data: s, error: sErr } = await supabase
      .from('player_match_stats')
      .select('*')
      .in('match_id', matchIds);
    if (sErr) throw sErr;
    stats = (s ?? []) as PlayerMatchStat[];
  }

  type StatRow = {
    match_id: number;
    player_id: number;
    faction: 'SHIRTS' | 'SKINS';
    kills: number;
    assists: number;
    deaths: number;
    adr: number;
    is_win: boolean;
  };

  const statsByMatch = new Map<number, StatRow[]>();
  for (const s of stats as StatRow[]) {
    const list = statsByMatch.get(s.match_id) ?? [];
    list.push(s);
    statsByMatch.set(s.match_id, list);
  }

  const matchesByWeek = new Map<number, MatchWithRoster[]>();
  for (const m of matchRows) {
    const roster = (statsByMatch.get(m.id) ?? []) as StatRow[];
    const shirtsStats = roster
      .filter((r) => r.faction === 'SHIRTS')
      .map((r) => ({
        match_id: r.match_id,
        player_id: r.player_id,
        player_name: players.get(r.player_id)?.name ?? `#${r.player_id}`,
        faction: 'SHIRTS' as const,
        kills: r.kills,
        assists: r.assists ?? 0,
        deaths: r.deaths,
        adr: r.adr,
        is_win: !!r.is_win,
      }));
    const skinsStats = roster
      .filter((r) => r.faction === 'SKINS')
      .map((r) => ({
        match_id: r.match_id,
        player_id: r.player_id,
        player_name: players.get(r.player_id)?.name ?? `#${r.player_id}`,
        faction: 'SKINS' as const,
        kills: r.kills,
        assists: r.assists ?? 0,
        deaths: r.deaths,
        adr: r.adr,
        is_win: !!r.is_win,
      }));

    const list = matchesByWeek.get(m.week_id) ?? [];
    // Attach stats arrays as shirts_stats/skins_stats (may be empty)
    list.push({ ...m, shirts: shirtsStats.map(s => ({ player_id: s.player_id, player_name: s.player_name })), skins: skinsStats.map(s => ({ player_id: s.player_id, player_name: s.player_name })), shirts_stats: shirtsStats, skins_stats: skinsStats });
    matchesByWeek.set(m.week_id, list);
  }

  return weekRows.map((w) => ({
    ...w,
    bye_player_name: w.bye_player_id
      ? players.get(w.bye_player_id)?.name ?? null
      : null,
    matches: matchesByWeek.get(w.id) ?? [],
  }));
}

export async function getMatch(matchId: number): Promise<MatchDetail | null> {
  const { data: match, error } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw error;
  if (!match) return null;
  const m = match as Match;

  const [{ data: week, error: wErr }, { data: stats, error: sErr }, players] =
    await Promise.all([
      supabase.from('weeks').select('*').eq('id', m.week_id).maybeSingle(),
      supabase
        .from('player_match_stats')
        .select('*')
        .eq('match_id', matchId),
      getPlayersById(),
    ]);
  if (wErr) throw wErr;
  if (sErr) throw sErr;
  const w = week as Week | null;
  if (!w) return null;

  const { data: season, error: seErr } = await supabase
    .from('seasons')
    .select('*')
    .eq('id', w.season_id)
    .maybeSingle();
  if (seErr) throw seErr;
  if (!season) return null;

  const statRows: MatchStatRow[] = ((stats ?? []) as PlayerMatchStat[]).map(
    (s) => ({
      ...s,
      player_name: players.get(s.player_id)?.name ?? `#${s.player_id}`,
      steam_avatar_url: players.get(s.player_id)?.steam_avatar_url ?? null,
    }),
  );

  return { match: m, week: w, season: season as Season, stats: statRows };
}

export interface MapLeagueAvg {
  wins: number;
  losses: number;
  adr: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
}

export interface MapStat {
  games: number;
  wins: number;
  losses: number;
  adr: number;
  rwr: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
}

export interface ScoutingPlayer {
  id: number;
  name: string;
  steam_avatar_url: string | null;
  /** Average ADR across all played matches. */
  adr: number;
  /** Average rounds-won rate across all played matches. */
  rwr: number;
  /** Last-5 results, oldest → most recent. */
  form: boolean[];
  streak: { result: 'W' | 'L'; count: number } | null;
  /** Chronological ADR values (most recent ~6 matches), for the mini sparkline. */
  adrSeries: number[];
  /** Per-map aggregates keyed by mapSlug. */
  mapStats: Record<string, MapStat>;
}

export interface MatchScoutingData {
  shirts: [ScoutingPlayer, ScoutingPlayer];
  skins: [ScoutingPlayer, ScoutingPlayer];
  mapLeagueAverages: Record<string, MapLeagueAvg>;
}

/**
 * Pre-match intel for the four rostered players: recent form, ADR trend, and
 * how each has performed on the picked map. Used by the scouting report shown
 * before scores are entered.
 */
export async function getMatchScoutingData(matchId: number): Promise<MatchScoutingData | null> {
  const { data: match, error: mErr } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!match) return null;
  const m = match as Match;

  const { data: roster, error: rErr } = await supabase
    .from('player_match_stats')
    .select('player_id, faction')
    .eq('match_id', matchId);
  if (rErr) throw rErr;
  const rosterRows = (roster ?? []) as { player_id: number; faction: Faction }[];
  if (rosterRows.length === 0) return null;
  const playerIds = rosterRows.map((r) => r.player_id);

  // TODO: replace unbounded fetches with paginated queries — see GH issue #73.
  const [{ data: statRows, error: sErr }, players, { data: leagueStatRows, error: lsErr }, { data: leagueMatchRows, error: lmErr }] = await Promise.all([
    supabase.from('player_match_stats').select('*').in('player_id', playerIds).limit(10000),
    getPlayersById(),
    supabase.from('player_match_stats').select('match_id, adr, kills, deaths, assists, is_win').gt('rounds_played', 0).limit(10000),
    supabase.from('matches').select('id, final_score, shirts_pick, picked_map').limit(10000),
  ]);
  if (sErr) throw sErr;
  if (lsErr) throw lsErr;
  if (lmErr) throw lmErr;
  const allStats = (statRows ?? []) as PlayerMatchStat[];

  const matchIds = Array.from(new Set(allStats.map((s) => s.match_id)));
  const { data: matches, error: matchesErr } = await supabase.from('matches').select('*').in('id', matchIds);
  if (matchesErr) throw matchesErr;
  const matchById = new Map<number, Match>();
  for (const mm of (matches ?? []) as Match[]) matchById.set(mm.id, mm);

  const weekIds = Array.from(new Set((matches ?? []).map((mm) => (mm as Match).week_id)));
  const { data: weeks, error: wErr } = await supabase.from('weeks').select('*').in('id', weekIds);
  if (wErr) throw wErr;
  const weekById = new Map<number, Week>();
  for (const w of (weeks ?? []) as Week[]) weekById.set(w.id, w);

  const seasonIds = Array.from(new Set((weeks ?? []).map((w) => (w as Week).season_id)));
  const { data: seasons, error: seErr } = await supabase.from('seasons').select('id, name, is_gauntlet').in('id', seasonIds);
  if (seErr) throw seErr;
  const seasonNameById = new Map<number, string>();
  const seasonIsGauntletById = new Map<number, boolean>();
  for (const s of (seasons ?? []) as { id: number; name: string; is_gauntlet: boolean }[]) {
    seasonNameById.set(s.id, s.name);
    seasonIsGauntletById.set(s.id, s.is_gauntlet);
  }

  function buildPlayer(playerId: number): ScoutingPlayer {
    const p = players.get(playerId);

    const rows = allStats
      .filter((s) => s.player_id === playerId && s.rounds_played > 0)
      .map((s) => {
        const mm = matchById.get(s.match_id);
        const w = mm ? weekById.get(mm.week_id) : undefined;
        return mm && w && isPlayedScore(mm.final_score) ? { stat: s, match: mm, week: w } : null;
      })
      .filter((r): r is { stat: PlayerMatchStat; match: Match; week: Week } => r !== null)
      .sort((a, b) =>
        -compareMatchRefDesc(
          { seasonNumber: extractSeasonNumber(seasonNameById.get(a.week.season_id) ?? ''), isGauntlet: seasonIsGauntletById.get(a.week.season_id) ?? false, weekNumber: a.week.week_number, matchNumber: a.match.match_number },
          { seasonNumber: extractSeasonNumber(seasonNameById.get(b.week.season_id) ?? ''), isGauntlet: seasonIsGauntletById.get(b.week.season_id) ?? false, weekNumber: b.week.week_number, matchNumber: b.match.match_number },
        ),
      ); // chronological, oldest first

    const adrAll = rows.map((r) => r.stat.adr);
    const adr = adrAll.length > 0 ? avgOf(adrAll) : 0;

    const form = rows.slice(-5).map((r) => r.stat.is_win);

    let streak: { result: 'W' | 'L'; count: number } | null = null;
    if (rows.length > 0) {
      const last = rows[rows.length - 1].stat.is_win;
      let count = 0;
      for (let i = rows.length - 1; i >= 0 && rows[i].stat.is_win === last; i--) count++;
      streak = { result: last ? 'W' : 'L', count };
    }

    const adrSeries = rows.slice(-6).map((r) => r.stat.adr);

    const rwrAll = rows.map((r) => r.stat.rounds_won / Math.max(1, r.stat.rounds_played));
    const rwr = rwrAll.length > 0 ? avgOf(rwrAll) : 0;

    const mapGroups = new Map<string, typeof rows>();
    for (const r of rows) {
      const slug = mapSlug((r.match.shirts_pick ?? r.match.picked_map) ?? '');
      if (!slug) continue;
      if (!mapGroups.has(slug)) mapGroups.set(slug, []);
      mapGroups.get(slug)!.push(r);
    }
    const mapStats: Record<string, MapStat> = {};
    for (const [slug, mRows] of mapGroups) {
      const n = mRows.length;
      mapStats[slug] = {
        games: n,
        wins: mRows.filter((r) => r.stat.is_win).length,
        losses: mRows.filter((r) => !r.stat.is_win).length,
        adr: mRows.reduce((s, r) => s + r.stat.adr, 0) / n,
        rwr: mRows.reduce((s, r) => s + r.stat.rounds_won / Math.max(1, r.stat.rounds_played), 0) / n,
        avgKills: mRows.reduce((s, r) => s + r.stat.kills, 0) / n,
        avgDeaths: mRows.reduce((s, r) => s + r.stat.deaths, 0) / n,
        avgAssists: mRows.reduce((s, r) => s + r.stat.assists, 0) / n,
      };
    }

    return {
      id: playerId,
      name: p?.name ?? `#${playerId}`,
      steam_avatar_url: p?.steam_avatar_url ?? null,
      adr,
      rwr,
      form,
      streak,
      adrSeries,
      mapStats,
    };
  }

  type LeagueMatchRow = { id: number; final_score: string | null; shirts_pick: string | null; picked_map: string | null };
  const leagueMatchById = new Map<number, LeagueMatchRow>();
  for (const mm of (leagueMatchRows ?? []) as LeagueMatchRow[]) leagueMatchById.set(mm.id, mm);

  type LeagueStatRow = { match_id: number; adr: number; kills: number; deaths: number; assists: number; is_win: boolean };
  // Use a Set of match IDs to count unique matches (not player-stat rows).
  // Each Wingman match has 2 player rows per side, so row-counting would inflate counts by 2×.
  const leagueMapGroups = new Map<string, { adr: number[]; kills: number[]; deaths: number[]; assists: number[]; matches: Set<number> }>();
  for (const s of (leagueStatRows ?? []) as LeagueStatRow[]) {
    const mm = leagueMatchById.get(s.match_id);
    if (!mm || !isPlayedScore(mm.final_score)) continue;
    const slug = mapSlug((mm.shirts_pick ?? mm.picked_map) ?? '');
    if (!slug) continue;
    if (!leagueMapGroups.has(slug)) leagueMapGroups.set(slug, { adr: [], kills: [], deaths: [], assists: [], matches: new Set() });
    const g = leagueMapGroups.get(slug)!;
    g.adr.push(s.adr);
    g.kills.push(s.kills);
    g.deaths.push(s.deaths);
    g.assists.push(s.assists);
    g.matches.add(s.match_id);
  }
  const mapLeagueAverages: Record<string, MapLeagueAvg> = {};
  for (const [slug, g] of leagueMapGroups) {
    mapLeagueAverages[slug] = {
      wins: g.matches.size,
      losses: 0,
      adr: avgOf(g.adr),
      avgKills: avgOf(g.kills),
      avgDeaths: avgOf(g.deaths),
      avgAssists: avgOf(g.assists),
    };
  }

  const shirts = rosterRows.filter((r) => r.faction === 'SHIRTS').map((r) => buildPlayer(r.player_id));
  const skins = rosterRows.filter((r) => r.faction === 'SKINS').map((r) => buildPlayer(r.player_id));
  if (shirts.length !== 2 || skins.length !== 2) return null;
  return {
    shirts: shirts as [ScoutingPlayer, ScoutingPlayer],
    skins: skins as [ScoutingPlayer, ScoutingPlayer],
    mapLeagueAverages,
  };
}

export async function getPlayer(playerId: number): Promise<PlayerDetail | null> {
  const { data: player, error: pErr } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!player) return null;

  const [{ data: stats, error: sErr }, medalists] = await Promise.all([
    // TODO: replace with paginated fetch — see GH issue #73. Using a high limit for now.
    supabase.from('player_match_stats').select('*').eq('player_id', playerId).limit(10000),
    getAllSeasonMedalists(),
  ]);
  if (sErr) throw sErr;
  const trophies = medalists.get(playerId) ?? [];
  const statRows = (stats ?? []) as PlayerMatchStat[];
  if (statRows.length === 0) {
    return { player: player as Player, history: [], trophies };
  }

  const matchIds = Array.from(new Set(statRows.map((s) => s.match_id)));
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('*')
    .in('id', matchIds);
  if (mErr) throw mErr;
  const matchById = new Map<number, Match>();
  for (const m of (matches ?? []) as Match[]) matchById.set(m.id, m);

  const weekIds = Array.from(
    new Set((matches ?? []).map((m) => (m as Match).week_id)),
  );
  const { data: weeks, error: wErr } = await supabase
    .from('weeks')
    .select('*')
    .in('id', weekIds);
  if (wErr) throw wErr;
  const weekById = new Map<number, Week>();
  for (const w of (weeks ?? []) as Week[]) weekById.set(w.id, w);

  const seasonIds = Array.from(
    new Set((weeks ?? []).map((w) => (w as Week).season_id)),
  );
  const { data: seasons, error: seErr } = await supabase
    .from('seasons')
    .select('*')
    .in('id', seasonIds);
  if (seErr) throw seErr;
  const seasonById = new Map<number, Season>();
  for (const s of (seasons ?? []) as Season[]) seasonById.set(s.id, s);

  // Fetch all stat rows for the involved matches so we can show full rosters.
  const [{ data: allStats, error: aErr }, players] = await Promise.all([
    supabase
      .from('player_match_stats')
      .select('*')
      .in('match_id', matchIds),
    getPlayersById(),
  ]);
  if (aErr) throw aErr;

  type StatRow = {
    match_id: number;
    player_id: number;
    faction: 'SHIRTS' | 'SKINS';
    kills: number;
    assists: number;
    deaths: number;
    adr: number;
    is_win: boolean;
  };

  const rosterByMatch = new Map<
    number,
    { shirts: { player_id: number; player_name: string }[]; skins: { player_id: number; player_name: string }[]; shirts_stats?: StatRow[]; skins_stats?: StatRow[] }
  >();
  for (const st of (allStats ?? []) as StatRow[]) {
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

  const history = statRows
    .map((s) => {
      const m = matchById.get(s.match_id);
      if (!m) return null;
      const w = weekById.get(m.week_id);
      if (!w) return null;
      const se = seasonById.get(w.season_id);
      if (!se) return null;
      const roster = rosterByMatch.get(m.id) ?? { shirts: [], skins: [] };
      return {
        ...s,
        match_number: m.match_number,
        week_number: w.week_number,
        season_id: se.id,
        season_number: extractSeasonNumber(se.name),
        season_name: se.name,
        is_gauntlet: se.is_gauntlet,
        map: m.shirts_pick ?? m.picked_map,
        final_score: m.final_score,
        scheduled_at: m.scheduled_at,
        shirts: roster.shirts,
        skins: roster.skins,
        shirts_stats: roster.shirts_stats ?? [],
        skins_stats: roster.skins_stats ?? [],
        picked_map: m.picked_map,
        shirts_pick: m.shirts_pick,
        skins_starting_side: m.skins_starting_side,
        shirts_ban: m.shirts_ban,
        shirts_ban2: m.shirts_ban2,
        skins_ban1: m.skins_ban1,
        skins_ban2: m.skins_ban2,
      };
    })
    .filter((r): r is PlayerHistoryRow => r !== null)
    .sort((a, b) =>
      compareMatchRefDesc(
        { seasonNumber: extractSeasonNumber(a.season_name), isGauntlet: a.is_gauntlet, weekNumber: a.week_number, matchNumber: a.match_number },
        { seasonNumber: extractSeasonNumber(b.season_name), isGauntlet: b.is_gauntlet, weekNumber: b.week_number, matchNumber: b.match_number },
      ),
    );

  return { player: player as Player, history, trophies };
}

export async function getSeasonLeaderboard(
  seasonId: number,
): Promise<LeaderboardRowWithId[]> {
  const [{ data: rows, error }, playersById, { perPlayerStats: perPlayer, rosterBySeason }] = await Promise.all([
    supabase
      .from('player_season_leaderboard')
      .select('*')
      .eq('season_id', seasonId),
    getPlayersById(),
    getSeasonBaseData(),
  ]);
  if (error) throw error;

  const result = ((rows ?? []) as LeaderboardRow[]).map((r) => {
    const ps = perPlayer.get(`${r.season_id}:${r.player_id}`);
    const total_rounds_played = n(r.total_rounds_played);
    const total_rounds_won = ps?.rounds_won ?? 0;
    return {
      ...normalizeRow(r),
      total_assists: ps?.assists ?? 0,
      total_rounds_won,
      rwr_percentage: total_rounds_played > 0 ? (total_rounds_won / total_rounds_played) * 100 : 0,
      kills_in_wins: ps?.kills_in_wins ?? 0,
      deaths_in_wins: ps?.deaths_in_wins ?? 0,
      kills_in_losses: ps?.kills_in_losses ?? 0,
      deaths_in_losses: ps?.deaths_in_losses ?? 0,
    };
  });

  const rosterIds = rosterBySeason.get(seasonId);
  if (!rosterIds?.size) return result.sort(canonicalSort);

  if (result.length === 0) return zeroStatRows(seasonId, rosterIds, playersById);

  // Merge in zero-stat rows for rostered players who haven't played yet
  const playedIds = new Set(result.map((r) => r.player_id));
  const unseenIds = new Set([...rosterIds].filter((id) => !playedIds.has(id)));
  if (unseenIds.size > 0) result.push(...zeroStatRows(seasonId, unseenIds, playersById));
  return result.sort(canonicalSort);
}

/**
 * Career leaderboard — sums per-season leaderboard rows across all seasons,
 * skipping rows with no rounds played (S3 placeholder rows). K/D and ADR
 * are re-derived from totals so the math stays correct.
 */
export async function getCareerLeaderboard(): Promise<LeaderboardRowWithId[]> {
  const [{ data: rows, error }, { perPlayerStats: perPlayer, rosterBySeason }, playersById, { data: seasonRows, error: sErr }] = await Promise.all([
    supabase.from('player_season_leaderboard').select('*'),
    getSeasonBaseData(),
    getPlayersById(),
    supabase.from('seasons').select('id, status'),
  ]);
  if (error) throw error;
  if (sErr) throw sErr;

  const activeSeasonIds = new Set(
    ((seasonRows ?? []) as { id: number; status: string }[])
      .filter((s) => s.status === 'ACTIVE' || s.status === 'UPCOMING')
      .map((s) => s.id),
  );

  type Agg = {
    player_id: number;
    matches_played: number;
    matches_won: number;
    matches_lost: number;
    total_kills: number;
    total_assists: number;
    total_deaths: number;
    total_damage: number;
    total_rounds_played: number;
    total_rounds_won: number;
    kills_in_wins: number;
    deaths_in_wins: number;
    kills_in_losses: number;
    deaths_in_losses: number;
    seasons: Set<number>;
  };
  const byId = new Map<number, Agg>();
  const byName = new Map<string, Agg>();
  for (const raw of (rows ?? []) as LeaderboardRow[]) {
    const r = normalizeRow(raw);
    if (r.total_rounds_played === 0) continue; // skip unplayed placeholder rows
    const agg =
      byName.get(r.player_name) ??
      ({
        player_id: r.player_id,
        matches_played: 0,
        matches_won: 0,
        matches_lost: 0,
        total_kills: 0,
        total_assists: 0,
        total_deaths: 0,
        total_damage: 0,
        total_rounds_played: 0,
        total_rounds_won: 0,
        kills_in_wins: 0,
        deaths_in_wins: 0,
        kills_in_losses: 0,
        deaths_in_losses: 0,
        seasons: new Set<number>(),
      } as Agg);
    const ps = perPlayer.get(`${r.season_id}:${r.player_id}`);
    agg.matches_played += r.matches_played;
    agg.matches_won += r.matches_won;
    agg.matches_lost += r.matches_lost;
    agg.total_kills += r.total_kills;
    agg.total_assists += ps?.assists ?? 0;
    agg.total_deaths += r.total_deaths;
    agg.total_damage += r.total_damage;
    agg.total_rounds_played += r.total_rounds_played;
    agg.total_rounds_won += ps?.rounds_won ?? 0;
    agg.kills_in_wins += ps?.kills_in_wins ?? 0;
    agg.deaths_in_wins += ps?.deaths_in_wins ?? 0;
    agg.kills_in_losses += ps?.kills_in_losses ?? 0;
    agg.deaths_in_losses += ps?.deaths_in_losses ?? 0;
    agg.seasons.add(r.season_id);
    byName.set(r.player_name, agg);
    byId.set(r.player_id, agg);
  }

  // Add zero-stat entries for players rostered in active/upcoming seasons who
  // haven't played yet and therefore don't appear in player_season_leaderboard.
  for (const [seasonId, playerIds] of rosterBySeason) {
    if (!activeSeasonIds.has(seasonId)) continue;
    for (const pid of playerIds) {
      if (byId.has(pid)) continue;
      const player = playersById.get(pid);
      if (!player) continue;
      const agg: Agg = {
        player_id: pid,
        matches_played: 0,
        matches_won: 0,
        matches_lost: 0,
        total_kills: 0,
        total_assists: 0,
        total_deaths: 0,
        total_damage: 0,
        total_rounds_played: 0,
        total_rounds_won: 0,
        kills_in_wins: 0,
        deaths_in_wins: 0,
        kills_in_losses: 0,
        deaths_in_losses: 0,
        seasons: new Set(),
      };
      byName.set(player.name, agg);
      byId.set(pid, agg);
    }
  }

  const out: LeaderboardRowWithId[] = [];
  for (const [player_name, a] of byName) {
    out.push({
      season_id: 0,
      player_name,
      player_id: a.player_id,
      matches_played: a.matches_played,
      matches_won: a.matches_won,
      matches_lost: a.matches_lost,
      win_rate_percentage:
        a.matches_played > 0 ? (a.matches_won / a.matches_played) * 100 : 0,
      total_kills: a.total_kills,
      total_assists: a.total_assists,
      total_deaths: a.total_deaths,
      kd_ratio: a.total_deaths > 0 ? a.total_kills / a.total_deaths : a.total_kills,
      total_damage: a.total_damage,
      total_rounds_played: a.total_rounds_played,
      total_rounds_won: a.total_rounds_won,
      rwr_percentage: a.total_rounds_played > 0 ? (a.total_rounds_won / a.total_rounds_played) * 100 : 0,
      overall_adr:
        a.total_rounds_played > 0 ? a.total_damage / a.total_rounds_played : 0,
      kills_in_wins: a.kills_in_wins,
      deaths_in_wins: a.deaths_in_wins,
      kills_in_losses: a.kills_in_losses,
      deaths_in_losses: a.deaths_in_losses,
    });
  }
  return out.sort(canonicalSort);
}

function aggToRow(
  agg: {
    player_id: number;
    player_name: string;
    matches_played: number;
    matches_won: number;
    matches_lost: number;
    total_kills: number;
    total_assists: number;
    total_deaths: number;
    total_damage: number;
    total_rounds_played: number;
    total_rounds_won: number;
    kills_in_wins: number;
    deaths_in_wins: number;
    kills_in_losses: number;
    deaths_in_losses: number;
  },
  season_id: number,
): LeaderboardRowWithId {
  return {
    season_id,
    player_id: agg.player_id,
    player_name: agg.player_name,
    matches_played: agg.matches_played,
    matches_won: agg.matches_won,
    matches_lost: agg.matches_lost,
    win_rate_percentage:
      agg.matches_played > 0
        ? (agg.matches_won / agg.matches_played) * 100
        : 0,
    total_kills: agg.total_kills,
    total_assists: agg.total_assists,
    total_deaths: agg.total_deaths,
    kd_ratio:
      agg.total_deaths > 0
        ? agg.total_kills / agg.total_deaths
        : agg.total_kills,
    total_damage: agg.total_damage,
    total_rounds_played: agg.total_rounds_played,
    total_rounds_won: agg.total_rounds_won,
    rwr_percentage:
      agg.total_rounds_played > 0
        ? (agg.total_rounds_won / agg.total_rounds_played) * 100
        : 0,
    overall_adr:
      agg.total_rounds_played > 0
        ? agg.total_damage / agg.total_rounds_played
        : 0,
    kills_in_wins: agg.kills_in_wins,
    deaths_in_wins: agg.deaths_in_wins,
    kills_in_losses: agg.kills_in_losses,
    deaths_in_losses: agg.deaths_in_losses,
  };
}

/**
 * Aggregates stats from all gauntlet seasons (is_gauntlet = true).
 * The leaderboard view excludes playoff games, so we compute directly from
 * player_match_stats.
 */
export async function getGauntletStats(): Promise<{
  career: LeaderboardRowWithId[];
  bySeason: Record<number, LeaderboardRowWithId[]>;
}> {
  const { data: gauntletSeasons, error: gsErr } = await supabase
    .from('seasons')
    .select('id')
    .eq('is_gauntlet', true);
  if (gsErr) throw gsErr;
  if (!gauntletSeasons || gauntletSeasons.length === 0)
    return { career: [], bySeason: {} };

  const gauntletSeasonIds = (gauntletSeasons as { id: number }[]).map(
    (s) => s.id,
  );

  const { data: weeks, error: wErr } = await supabase
    .from('weeks')
    .select('id, season_id')
    .in('season_id', gauntletSeasonIds);
  if (wErr) throw wErr;
  if (!weeks || weeks.length === 0) return { career: [], bySeason: {} };

  const weekRows = weeks as { id: number; season_id: number }[];
  const weekToSeason = new Map<number, number>();
  for (const w of weekRows) weekToSeason.set(w.id, w.season_id);

  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, week_id, final_score')
    .in(
      'week_id',
      weekRows.map((w) => w.id),
    )
    .eq('is_playoff_game', true);
  if (mErr) throw mErr;
  if (!matches || matches.length === 0) return { career: [], bySeason: {} };

  const matchRows = (matches as { id: number; week_id: number; final_score: string | null }[])
    .filter((m) => isPlayedScore(m.final_score));
  const matchToSeason = new Map<number, number>();
  for (const m of matchRows) {
    const sid = weekToSeason.get(m.week_id);
    if (sid != null) matchToSeason.set(m.id, sid);
  }

  const [{ data: stats, error: sErr }, players] = await Promise.all([
    supabase
      .from('player_match_stats')
      .select('*')
      .in(
        'match_id',
        matchRows.map((m) => m.id),
      ),
    getPlayersById(),
  ]);
  if (sErr) throw sErr;

  type Agg = {
    player_id: number;
    player_name: string;
    matches_played: number;
    matches_won: number;
    matches_lost: number;
    total_kills: number;
    total_assists: number;
    total_deaths: number;
    total_damage: number;
    total_rounds_played: number;
    total_rounds_won: number;
    kills_in_wins: number;
    deaths_in_wins: number;
    kills_in_losses: number;
    deaths_in_losses: number;
  };

  const bySeasonPlayer = new Map<string, Agg>();

  for (const s of (stats ?? []) as PlayerMatchStat[]) {
    const sid = matchToSeason.get(s.match_id);
    if (sid == null) continue;
    const player = players.get(s.player_id);
    if (!player) continue;
    const key = `${sid}:${s.player_id}`;
    const agg = bySeasonPlayer.get(key) ?? {
      player_id: s.player_id,
      player_name: player.name,
      matches_played: 0,
      matches_won: 0,
      matches_lost: 0,
      total_kills: 0,
      total_assists: 0,
      total_deaths: 0,
      total_damage: 0,
      total_rounds_played: 0,
      total_rounds_won: 0,
      kills_in_wins: 0,
      deaths_in_wins: 0,
      kills_in_losses: 0,
      deaths_in_losses: 0,
    };
    agg.matches_played += 1;
    agg.matches_won += s.is_win ? 1 : 0;
    agg.matches_lost += s.is_win ? 0 : 1;
    agg.total_kills += s.kills;
    agg.total_assists += s.assists;
    agg.total_deaths += s.deaths;
    agg.total_damage += s.damage;
    agg.total_rounds_played += s.rounds_played;
    agg.total_rounds_won += s.rounds_won;
    agg.kills_in_wins += s.is_win ? s.kills : 0;
    agg.deaths_in_wins += s.is_win ? s.deaths : 0;
    agg.kills_in_losses += s.is_win ? 0 : s.kills;
    agg.deaths_in_losses += s.is_win ? 0 : s.deaths;
    bySeasonPlayer.set(key, agg);
  }

  const bySeason: Record<number, LeaderboardRowWithId[]> = {};
  const careerByPlayer = new Map<number, Agg>();

  for (const [key, agg] of bySeasonPlayer) {
    const sid = Number(key.split(':')[0]);
    const row = aggToRow(agg, sid);
    if (!bySeason[sid]) bySeason[sid] = [];
    bySeason[sid].push(row);

    const prev = careerByPlayer.get(agg.player_id) ?? { ...agg };
    if (careerByPlayer.has(agg.player_id)) {
      prev.matches_played += agg.matches_played;
      prev.matches_won += agg.matches_won;
      prev.matches_lost += agg.matches_lost;
      prev.total_kills += agg.total_kills;
      prev.total_assists += agg.total_assists;
      prev.total_deaths += agg.total_deaths;
      prev.total_damage += agg.total_damage;
      prev.total_rounds_played += agg.total_rounds_played;
      prev.total_rounds_won += agg.total_rounds_won;
      prev.kills_in_wins += agg.kills_in_wins;
      prev.deaths_in_wins += agg.deaths_in_wins;
      prev.kills_in_losses += agg.kills_in_losses;
      prev.deaths_in_losses += agg.deaths_in_losses;
    }
    careerByPlayer.set(agg.player_id, prev);
  }

  for (const sid of Object.keys(bySeason))
    bySeason[Number(sid)].sort(canonicalSort);

  const career = Array.from(careerByPlayer.values())
    .map((agg) => aggToRow(agg, 0))
    .sort(canonicalSort);

  return { career, bySeason };
}

export interface GauntletPlayerStat {
  player_id: number;
  player_name: string;
  faction: 'SHIRTS' | 'SKINS';
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  is_win: boolean;
}

export interface GauntletMatch {
  id: number;
  match_number: number;
  final_score: string | null;
  picked_map: string | null;
  shirts_pick: string | null;
  skins_starting_side: 'CT' | 'T' | null;
  shirts_stats: GauntletPlayerStat[];
  skins_stats: GauntletPlayerStat[];
}

export interface GauntletRound {
  round_number: number;
  matches: GauntletMatch[];
}

/** Per-season gauntlet leaderboard — same shape as the regular leaderboard view. */
export async function getGauntletSeasonLeaderboard(
  seasonId: number,
): Promise<LeaderboardRowWithId[]> {
  const { data: weeks, error: wErr } = await supabase
    .from('weeks')
    .select('id')
    .eq('season_id', seasonId);
  if (wErr) throw wErr;
  if (!weeks || weeks.length === 0) return [];

  const weekIds = (weeks as { id: number }[]).map((w) => w.id);

  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, final_score')
    .in('week_id', weekIds)
    .eq('is_playoff_game', true);
  if (mErr) throw mErr;
  if (!matches || matches.length === 0) return [];

  const matchIds = (matches as { id: number; final_score: string | null }[])
    .filter((m) => isPlayedScore(m.final_score))
    .map((m) => m.id);

  const [{ data: stats, error: sErr }, players] = await Promise.all([
    supabase
      .from('player_match_stats')
      .select('player_id, kills, assists, deaths, damage, rounds_played, rounds_won, is_win')
      .in('match_id', matchIds),
    getPlayersById(),
  ]);
  if (sErr) throw sErr;

  type RawRow = {
    player_id: number;
    kills: number;
    assists: number;
    deaths: number;
    damage: number;
    rounds_played: number;
    rounds_won: number;
    is_win: boolean;
  };

  type Agg = {
    player_id: number;
    player_name: string;
    matches_played: number;
    matches_won: number;
    matches_lost: number;
    total_kills: number;
    total_assists: number;
    total_deaths: number;
    total_damage: number;
    total_rounds_played: number;
    total_rounds_won: number;
    kills_in_wins: number;
    deaths_in_wins: number;
    kills_in_losses: number;
    deaths_in_losses: number;
  };

  const byPlayer = new Map<number, Agg>();
  for (const s of (stats ?? []) as RawRow[]) {
    const player = players.get(s.player_id);
    if (!player) continue;
    const agg = byPlayer.get(s.player_id) ?? {
      player_id: s.player_id,
      player_name: player.name,
      matches_played: 0,
      matches_won: 0,
      matches_lost: 0,
      total_kills: 0,
      total_assists: 0,
      total_deaths: 0,
      total_damage: 0,
      total_rounds_played: 0,
      total_rounds_won: 0,
      kills_in_wins: 0,
      deaths_in_wins: 0,
      kills_in_losses: 0,
      deaths_in_losses: 0,
    };
    agg.matches_played += 1;
    agg.matches_won += s.is_win ? 1 : 0;
    agg.matches_lost += s.is_win ? 0 : 1;
    agg.total_kills += s.kills;
    agg.total_assists += s.assists;
    agg.total_deaths += s.deaths;
    agg.total_damage += s.damage;
    agg.total_rounds_played += s.rounds_played;
    agg.total_rounds_won += s.rounds_won;
    agg.kills_in_wins += s.is_win ? s.kills : 0;
    agg.deaths_in_wins += s.is_win ? s.deaths : 0;
    agg.kills_in_losses += s.is_win ? 0 : s.kills;
    agg.deaths_in_losses += s.is_win ? 0 : s.deaths;
    byPlayer.set(s.player_id, agg);
  }

  return Array.from(byPlayer.values())
    .map((agg) => ({
      ...aggToRow(agg, seasonId),
      steam_avatar_url: players.get(agg.player_id)?.steam_avatar_url ?? null,
    }))
    .sort(canonicalSort);
}

/** Fetches all matches for a gauntlet season and groups them into rounds by week_number. */
export async function getGauntletRounds(seasonId: number): Promise<GauntletRound[]> {
  const { data: weeks, error: wErr } = await supabase
    .from('weeks')
    .select('id, week_number')
    .eq('season_id', seasonId)
    .order('week_number');
  if (wErr) throw wErr;
  if (!weeks || weeks.length === 0) return [];

  const weekRows = weeks as { id: number; week_number: number }[];
  const weekIds = weekRows.map((w) => w.id);

  const { data: matchData, error: mErr } = await supabase
    .from('matches')
    .select('*')
    .in('week_id', weekIds)
    .order('match_number');
  if (mErr) throw mErr;
  const matchRows = (matchData ?? []) as Match[];
  if (matchRows.length === 0) return [];

  const matchIds = matchRows.map((m) => m.id);
  const [{ data: stats, error: sErr }, players] = await Promise.all([
    supabase
      .from('player_match_stats')
      .select('match_id, player_id, faction, kills, assists, deaths, adr, is_win')
      .in('match_id', matchIds),
    getPlayersById(),
  ]);
  if (sErr) throw sErr;

  type RawStat = {
    match_id: number;
    player_id: number;
    faction: string;
    kills: number;
    assists: number;
    deaths: number;
    adr: number;
    is_win: boolean;
  };

  const statsByMatch = new Map<number, GauntletPlayerStat[]>();
  for (const s of (stats ?? []) as RawStat[]) {
    const list = statsByMatch.get(s.match_id) ?? [];
    const player = players.get(s.player_id);
    list.push({
      player_id: s.player_id,
      player_name: player?.name ?? `#${s.player_id}`,
      faction: s.faction as 'SHIRTS' | 'SKINS',
      kills: s.kills,
      assists: s.assists ?? 0,
      deaths: s.deaths,
      adr: s.adr,
      is_win: s.is_win,
    });
    statsByMatch.set(s.match_id, list);
  }

  // Group match rows by week_id so we can assign round_number from week_number.
  const matchesByWeekId = new Map<number, Match[]>();
  for (const m of matchRows) {
    const list = matchesByWeekId.get(m.week_id) ?? [];
    list.push(m);
    matchesByWeekId.set(m.week_id, list);
  }

  const rounds: GauntletRound[] = [];
  for (const week of weekRows) {
    const weekMatches = (matchesByWeekId.get(week.id) ?? []).sort(
      (a, b) => a.match_number - b.match_number,
    );
    const gauntletMatches: GauntletMatch[] = weekMatches.map((m) => {
      const allStats = statsByMatch.get(m.id) ?? [];
      return {
        id: m.id,
        match_number: m.match_number,
        final_score: m.final_score,
        picked_map: m.picked_map,
        shirts_pick: m.shirts_pick,
        skins_starting_side: m.skins_starting_side,
        shirts_stats: allStats.filter((s) => s.faction === 'SHIRTS'),
        skins_stats: allStats.filter((s) => s.faction === 'SKINS'),
      };
    });
    rounds.push({ round_number: week.week_number, matches: gauntletMatches });
  }
  return rounds;
}

export type GauntletSummary = {
  playerCount: number;
  roundCount: number;
  champion: { player_id: number; name: string } | null;
};

/**
 * Returns a lightweight summary for every gauntlet season in one bulk fetch.
 * Champion = the player who won both matches in the final round.
 */
export async function getAllGauntletSummaries(): Promise<Map<number, GauntletSummary>> {
  const { data: gauntletSeasons } = await supabase
    .from('seasons')
    .select('id')
    .eq('is_gauntlet', true);
  if (!gauntletSeasons || gauntletSeasons.length === 0) return new Map();
  const seasonIds = (gauntletSeasons as { id: number }[]).map((s) => s.id);

  const [{ data: weeks }, players] = await Promise.all([
    supabase.from('weeks').select('id, season_id, week_number').in('season_id', seasonIds),
    getPlayersById(),
  ]);
  const weekRows = (weeks ?? []) as { id: number; season_id: number; week_number: number }[];
  if (weekRows.length === 0) return new Map();

  const weekIds = weekRows.map((w) => w.id);
  const { data: matchData } = await supabase
    .from('matches')
    .select('id, week_id, final_score')
    .in('week_id', weekIds);
  const matchRows = (matchData ?? []) as { id: number; week_id: number; final_score: string | null }[];
  if (matchRows.length === 0) return new Map();

  const matchIds = matchRows.map((m) => m.id);
  const { data: statData } = await supabase
    .from('player_match_stats')
    .select('match_id, player_id, is_win')
    .in('match_id', matchIds);
  const statRows = (statData ?? []) as { match_id: number; player_id: number; is_win: boolean }[];

  // Build lookup maps
  const matchesByWeek = new Map<number, { id: number; final_score: string | null }[]>();
  for (const m of matchRows) {
    const list = matchesByWeek.get(m.week_id) ?? [];
    list.push(m);
    matchesByWeek.set(m.week_id, list);
  }
  const statsByMatch = new Map<number, { player_id: number; is_win: boolean }[]>();
  for (const s of statRows) {
    const list = statsByMatch.get(s.match_id) ?? [];
    list.push(s);
    statsByMatch.set(s.match_id, list);
  }

  const out = new Map<number, GauntletSummary>();

  for (const seasonId of seasonIds) {
    const seasonWeeks = weekRows.filter((w) => w.season_id === seasonId);
    const roundCount = seasonWeeks.length;

    // Unique players across all matches in this season
    const playerIds = new Set<number>();
    for (const w of seasonWeeks) {
      for (const m of matchesByWeek.get(w.id) ?? []) {
        if (!isPlayedScore(m.final_score)) continue;
        for (const s of statsByMatch.get(m.id) ?? []) {
          playerIds.add(s.player_id);
        }
      }
    }

    // Champion: player who won both matches in the final round
    let champion: { player_id: number; name: string } | null = null;
    if (seasonWeeks.length > 0) {
      const finalWeek = seasonWeeks.reduce((best, w) =>
        w.week_number > best.week_number ? w : best,
      );
      const finalMatches = matchesByWeek.get(finalWeek.id) ?? [];
      const allPlayed = finalMatches.length > 0 && finalMatches.every((m) => isPlayedScore(m.final_score));
      if (allPlayed) {
        const wins = new Map<number, number>();
        for (const m of finalMatches) {
          for (const s of statsByMatch.get(m.id) ?? []) {
            if (s.is_win) wins.set(s.player_id, (wins.get(s.player_id) ?? 0) + 1);
          }
        }
        for (const [pid, w] of wins) {
          if (w === finalMatches.length) {
            champion = { player_id: pid, name: players.get(pid)?.name ?? `#${pid}` };
            break;
          }
        }
      }
    }

    out.set(seasonId, { playerCount: playerIds.size, roundCount, champion });
  }

  return out;
}

export interface TrophyStatLine {
  kills: number;
  assists: number;
  deaths: number;
  win_rate_percentage: number;
  rounds_won: number;
  rounds_lost: number;
  overall_adr: number;
}

export interface TrophyEntry {
  season_id: number;
  season_name: string;
  is_gauntlet: boolean;
  rank: 1 | 2 | 3;
  stats: TrophyStatLine;
}

function toTrophyStats(r: LeaderboardRowWithId): TrophyStatLine {
  return {
    kills: r.total_kills,
    assists: r.total_assists,
    deaths: r.total_deaths,
    win_rate_percentage: r.win_rate_percentage,
    rounds_won: r.total_rounds_won,
    rounds_lost: Math.max(0, r.total_rounds_played - r.total_rounds_won),
    overall_adr: r.overall_adr,
  };
}

/**
 * All podium finishes (gold/silver/bronze) across every season, keyed by player_id.
 * Regular seasons: ARCHIVED only, ranked by canonical order (WR% -> RWR% -> ADR),
 * matching LeaderboardTable's medal logic. Gauntlets: champion + runners-up from
 * a fully-played final round, matching GauntletStandings.
 */
export async function getAllSeasonMedalists(): Promise<Map<number, TrophyEntry[]>> {
  const [seasons, leaderboards] = await Promise.all([getSeasons(), getAllLeaderboards()]);

  const out = new Map<number, TrophyEntry[]>();
  const add = (playerId: number, entry: TrophyEntry) => {
    const list = out.get(playerId) ?? [];
    list.push(entry);
    out.set(playerId, list);
  };

  // Regular seasons: ARCHIVED only, canonical rank WR% -> RWR% -> ADR, top 3
  for (const season of seasons) {
    if (season.is_gauntlet || season.status !== 'ARCHIVED') continue;
    const rows = leaderboards.get(season.id) ?? [];
    if (rows.length === 0) continue;
    [...rows]
      .sort(canonicalSort)
      .slice(0, 3)
      .forEach((r, i) => {
        add(r.player_id, {
          season_id: season.id,
          season_name: season.name,
          is_gauntlet: false,
          rank: (i + 1) as 1 | 2 | 3,
          stats: toTrophyStats(r),
        });
      });
  }

  // Gauntlets: champion + 2nd/3rd from a fully-played final round
  const gauntletSeasons = seasons.filter((s) => s.is_gauntlet);
  if (gauntletSeasons.length > 0) {
    const seasonIds = gauntletSeasons.map((s) => s.id);

    // The player_season_leaderboard view excludes playoff games, and gauntlet
    // matches are always flagged as playoff games — so gauntlet stats have to
    // be computed separately rather than read from `leaderboards`.
    const gauntletLeaderboards = new Map<number, LeaderboardRowWithId[]>(
      await Promise.all(
        gauntletSeasons.map(async (s): Promise<[number, LeaderboardRowWithId[]]> => [s.id, await getGauntletSeasonLeaderboard(s.id)]),
      ),
    );

    const { data: weekData } = await supabase
      .from('weeks')
      .select('id, season_id, week_number')
      .in('season_id', seasonIds);
    const weekRows = (weekData ?? []) as { id: number; season_id: number; week_number: number }[];

    if (weekRows.length > 0) {
      const weekIds = weekRows.map((w) => w.id);
      const { data: matchData } = await supabase
        .from('matches')
        .select('id, week_id, final_score')
        .in('week_id', weekIds);
      const matchRows = (matchData ?? []) as { id: number; week_id: number; final_score: string | null }[];

      const matchIds = matchRows.map((m) => m.id);
      const { data: statData } = matchIds.length
        ? await supabase.from('player_match_stats').select('match_id, player_id, is_win, rounds_won, rounds_played, adr').in('match_id', matchIds)
        : { data: [] as { match_id: number; player_id: number; is_win: boolean; rounds_won: number; rounds_played: number; adr: number }[] };
      const statRows = (statData ?? []) as { match_id: number; player_id: number; is_win: boolean; rounds_won: number; rounds_played: number; adr: number }[];

      const matchesByWeek = new Map<number, { id: number; final_score: string | null }[]>();
      for (const m of matchRows) {
        const list = matchesByWeek.get(m.week_id) ?? [];
        list.push(m);
        matchesByWeek.set(m.week_id, list);
      }
      const statsByMatch = new Map<number, { player_id: number; is_win: boolean }[]>();
      for (const s of statRows) {
        const list = statsByMatch.get(s.match_id) ?? [];
        list.push(s);
        statsByMatch.set(s.match_id, list);
      }

      for (const season of gauntletSeasons) {
        const seasonWeeks = weekRows.filter((w) => w.season_id === season.id);
        if (seasonWeeks.length === 0) continue;
        const finalWeek = seasonWeeks.reduce((best, w) => (w.week_number > best.week_number ? w : best));
        const finalMatches = matchesByWeek.get(finalWeek.id) ?? [];
        if (finalMatches.length === 0 || !finalMatches.every((m) => isPlayedScore(m.final_score))) continue;

        const records = new Map<number, { player_id: number; wins: number }>();
        for (const m of finalMatches) {
          for (const s of statsByMatch.get(m.id) ?? []) {
            const prev = records.get(s.player_id) ?? { player_id: s.player_id, wins: 0 };
            if (s.is_win) prev.wins++;
            records.set(s.player_id, prev);
          }
        }
        const recordList = Array.from(records.values());
        const champion = recordList.find((r) => r.wins === 2) ?? null;
        if (!champion) continue;

        const seasonLeaderboard = gauntletLeaderboards.get(season.id) ?? [];
        const statsByPlayer = new Map(seasonLeaderboard.map((r) => [r.player_id, r]));

        const finalMatchIds = new Set(finalMatches.map((m) => m.id));
        const finalRoundAgg = new Map<number, { rounds_won: number; rounds_played: number; total_damage: number }>();
        for (const s of statRows.filter((s) => finalMatchIds.has(s.match_id))) {
          const prev = finalRoundAgg.get(s.player_id) ?? { rounds_won: 0, rounds_played: 0, total_damage: 0 };
          prev.rounds_won += s.rounds_won;
          prev.rounds_played += s.rounds_played;
          prev.total_damage += s.adr * s.rounds_played;
          finalRoundAgg.set(s.player_id, prev);
        }

        const contenders = recordList
          .filter((r) => r.wins === 1)
          .sort((a, b) => {
            const af = finalRoundAgg.get(a.player_id);
            const bf = finalRoundAgg.get(b.player_id);
            if (!af || !bf) return 0;
            const aRwr = af.rounds_played > 0 ? af.rounds_won / af.rounds_played : 0;
            const bRwr = bf.rounds_played > 0 ? bf.rounds_won / bf.rounds_played : 0;
            const aAdr = af.rounds_played > 0 ? af.total_damage / af.rounds_played : 0;
            const bAdr = bf.rounds_played > 0 ? bf.total_damage / bf.rounds_played : 0;
            return bRwr - aRwr || bAdr - aAdr;
          });

        const zeroStats: TrophyStatLine = {
          kills: 0, assists: 0, deaths: 0, win_rate_percentage: 0, rounds_won: 0, rounds_lost: 0, overall_adr: 0,
        };
        const podium: { player_id: number; rank: 1 | 2 | 3 }[] = [
          { player_id: champion.player_id, rank: 1 },
          ...(contenders[0] ? [{ player_id: contenders[0].player_id, rank: 2 as const }] : []),
          ...(contenders[1] ? [{ player_id: contenders[1].player_id, rank: 3 as const }] : []),
        ];
        for (const { player_id, rank } of podium) {
          const ps = statsByPlayer.get(player_id);
          add(player_id, {
            season_id: season.id,
            season_name: season.name,
            is_gauntlet: true,
            rank,
            stats: ps ? toTrophyStats(ps) : zeroStats,
          });
        }
      }
    }
  }

  return out;
}

/** Find the gauntlet season paired to a regular season by season number in name. */
export async function getLinkedGauntlet(regularSeasonName: string): Promise<Season | null> {
  const num = extractSeasonNumber(regularSeasonName);
  if (num == null) return null;
  const { data, error } = await supabase.from('seasons').select('*').eq('is_gauntlet', true);
  if (error) throw error;
  return ((data ?? []) as Season[]).find((s) => extractSeasonNumber(s.name) === num) ?? null;
}

/** Find the regular season paired to a gauntlet season by season number in name. */
export async function getLinkedRegularSeason(gauntletName: string): Promise<Season | null> {
  const num = extractSeasonNumber(gauntletName);
  if (num == null) return null;
  const { data, error } = await supabase.from('seasons').select('*').eq('is_gauntlet', false);
  if (error) throw error;
  return ((data ?? []) as Season[]).find((s) => extractSeasonNumber(s.name) === num) ?? null;
}

export interface MapPlayerStat {
  player_id: number;
  player_name: string;
  faction: Faction;
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  damage: number;
  rounds_played: number;
  rounds_won: number;
  is_win: boolean;
}

export interface MapMatchRow {
  match_id: number;
  match_number: number;
  week_number: number;
  season_id: number;
  season_number: number | null;
  season_name: string;
  is_gauntlet: boolean;
  is_playoff_game: boolean;
  final_score: string | null;
  shirts_stats: MapPlayerStat[];
  skins_stats: MapPlayerStat[];
  picked_map: string | null;
  shirts_pick: string | null;
  skins_starting_side: 'CT' | 'T' | null;
}

export interface MapDetail {
  name: string;
  slug: string;
  pickCount: number;
  banCount: number;
  noPickCount: number;
  seasons: { id: number; name: string; is_gauntlet: boolean }[];
  matches: MapMatchRow[];
  playerStats: LeaderboardRowWithId[];
}

/**
 * Returns all played matches with pick/ban data and per-faction win flags.
 * Used by the statistics page to compute league-wide map pick/ban and side stats.
 */
export async function getAllMatchesWithPickBan(): Promise<MapMatchRow[]> {
  const { matches, weeks, seasons } = await fetchMapRawData();

  const weekById = new Map<number, RawWeek>();
  for (const w of weeks) weekById.set(w.id, w);
  const seasonById = new Map<number, RawSeason>();
  for (const s of seasons) seasonById.set(s.id, s);

  const playedMatches = matches.filter(
    (m) => isPlayedScore(m.final_score) && (m.shirts_pick != null || m.picked_map != null),
  );
  if (playedMatches.length === 0) return [];

  const matchIds = playedMatches.map((m) => m.id);
  const [{ data: statsData, error: sErr }, players] = await Promise.all([
    supabase.from('player_match_stats').select('*').in('match_id', matchIds),
    getPlayersById(),
  ]);
  if (sErr) throw sErr;
  const statRows = (statsData ?? []) as PlayerMatchStat[];

  const rosterByMatch = new Map<number, { shirts: MapPlayerStat[]; skins: MapPlayerStat[] }>();
  for (const s of statRows) {
    const entry = rosterByMatch.get(s.match_id) ?? { shirts: [], skins: [] };
    const player = players.get(s.player_id);
    const stat: MapPlayerStat = {
      player_id: s.player_id,
      player_name: player?.name ?? `#${s.player_id}`,
      faction: s.faction,
      kills: s.kills,
      assists: s.assists ?? 0,
      deaths: s.deaths,
      adr: s.adr ?? 0,
      damage: s.damage ?? 0,
      rounds_played: s.rounds_played ?? 0,
      rounds_won: s.rounds_won ?? 0,
      is_win: !!s.is_win,
    };
    if (s.faction === 'SHIRTS') entry.shirts.push(stat);
    else entry.skins.push(stat);
    rosterByMatch.set(s.match_id, entry);
  }

  return playedMatches
    .map((m) => {
      const week = weekById.get(m.week_id);
      if (!week) return null;
      const season = seasonById.get(week.season_id);
      if (!season) return null;
      const roster = rosterByMatch.get(m.id) ?? { shirts: [], skins: [] };
      return {
        match_id: m.id,
        match_number: m.match_number,
        week_number: week.week_number,
        season_id: season.id,
        season_number: extractSeasonNumber(season.name),
        season_name: season.name,
        is_gauntlet: season.is_gauntlet,
        is_playoff_game: m.is_playoff_game,
        final_score: m.final_score,
        shirts_stats: roster.shirts,
        skins_stats: roster.skins,
        picked_map: m.picked_map,
        shirts_pick: m.shirts_pick,
        skins_starting_side: m.skins_starting_side,
      };
    })
    .filter((r): r is MapMatchRow => r !== null);
}

/** Returns leaderboards for every season, keyed by season_id. */
export async function getAllLeaderboards(): Promise<
  Map<number, LeaderboardRowWithId[]>
> {
  const [{ data: rows, error }, playersById, { perPlayerStats: perPlayer, rosterBySeason }] = await Promise.all([
    supabase
      .from('player_season_leaderboard')
      .select('*'),
    getPlayersById(),
    getSeasonBaseData(),
  ]);
  if (error) throw error;

  const out = new Map<number, LeaderboardRowWithId[]>();
  for (const r of (rows ?? []) as LeaderboardRow[]) {
    const ps = perPlayer.get(`${r.season_id}:${r.player_id}`);
    const total_rounds_played = n(r.total_rounds_played);
    const total_rounds_won = ps?.rounds_won ?? 0;
    const withId: LeaderboardRowWithId = {
      ...normalizeRow(r),
      total_assists: ps?.assists ?? 0,
      total_rounds_won,
      rwr_percentage: total_rounds_played > 0 ? (total_rounds_won / total_rounds_played) * 100 : 0,
      kills_in_wins: ps?.kills_in_wins ?? 0,
      deaths_in_wins: ps?.deaths_in_wins ?? 0,
      kills_in_losses: ps?.kills_in_losses ?? 0,
      deaths_in_losses: ps?.deaths_in_losses ?? 0,
    };
    const list = out.get(r.season_id) ?? [];
    list.push(withId);
    out.set(r.season_id, list);
  }

  for (const list of out.values()) list.sort(canonicalSort);

  // Merge in zero-stat rows for rostered players missing from each season's leaderboard
  for (const [seasonId, playerIds] of rosterBySeason) {
    const existing = out.get(seasonId);
    if (!existing) {
      out.set(seasonId, zeroStatRows(seasonId, playerIds, playersById));
    } else {
      const playedIds = new Set(existing.map((r) => r.player_id));
      const unseenIds = new Set([...playerIds].filter((id) => !playedIds.has(id)));
      if (unseenIds.size > 0) {
        existing.push(...zeroStatRows(seasonId, unseenIds, playersById));
        existing.sort(canonicalSort);
      }
    }
  }

  return out;
}

type RawMatch = {
  id: number;
  week_id: number;
  match_number: number;
  final_score: string | null;
  shirts_pick: string | null;
  picked_map: string | null;
  shirts_ban: string | null;
  shirts_ban2: string | null;
  skins_ban1: string | null;
  skins_ban2: string | null;
  is_playoff_game: boolean;
  skins_starting_side: 'CT' | 'T' | null;
};

type RawWeek = { id: number; season_id: number; week_number: number };
type RawSeason = { id: number; name: string; is_gauntlet: boolean; map_pool: string[] | null };

async function fetchMapRawData(): Promise<{
  matches: RawMatch[];
  weeks: RawWeek[];
  seasons: RawSeason[];
}> {
  const [{ data: matches, error: mErr }, { data: weeks, error: wErr }, { data: seasons, error: sErr }] =
    await Promise.all([
      supabase.from('matches').select('id, week_id, match_number, final_score, shirts_pick, picked_map, shirts_ban, shirts_ban2, skins_ban1, skins_ban2, is_playoff_game, skins_starting_side'),
      supabase.from('weeks').select('id, season_id, week_number'),
      supabase.from('seasons').select('id, name, is_gauntlet, map_pool'),
    ]);
  if (mErr) throw mErr;
  if (wErr) throw wErr;
  if (sErr) throw sErr;
  return {
    matches: (matches ?? []) as RawMatch[],
    weeks: (weeks ?? []) as RawWeek[],
    seasons: (seasons ?? []) as RawSeason[],
  };
}

function buildCanonicalNames(matches: RawMatch[], seasons: RawSeason[]): Map<string, string> {
  const canonical = new Map<string, string>();
  for (const m of matches) {
    for (const v of [m.shirts_pick, m.picked_map, m.shirts_ban, m.shirts_ban2, m.skins_ban1, m.skins_ban2]) {
      if (!v) continue;
      const t = v.trim();
      if (t && !canonical.has(t.toLowerCase())) canonical.set(t.toLowerCase(), t);
    }
  }
  for (const s of seasons) {
    for (const m of s.map_pool ?? []) {
      const t = m.trim();
      if (t && !canonical.has(t.toLowerCase())) canonical.set(t.toLowerCase(), t);
    }
  }
  return canonical;
}

export async function getMapIndex(): Promise<MapIndexEntry[]> {
  const { matches, weeks, seasons } = await fetchMapRawData();
  const canonicalName = buildCanonicalNames(matches, seasons);

  const weekToSeason = new Map<number, RawSeason>();
  for (const w of weeks) {
    const s = seasons.find((s) => s.id === w.season_id);
    if (s) weekToSeason.set(w.id, s);
  }

  const seasonById = new Map<number, RawSeason>();
  for (const s of seasons) seasonById.set(s.id, s);

  // per-map, per-season counts
  const picksBySeason = new Map<string, Map<number, number>>();
  const bansBySeason = new Map<string, Map<number, number>>();
  const pickCount = new Map<string, number>();
  const banCount = new Map<string, number>();
  const matchMapKey = new Map<number, string>();

  for (const m of matches) {
    if (!isPlayedScore(m.final_score)) continue;
    const season = weekToSeason.get(m.week_id);
    const picks = new Set([m.shirts_pick, m.picked_map].filter((v): v is string => !!v).map((v) => v.trim()));
    for (const played of picks) {
      const key = played.toLowerCase();
      pickCount.set(key, (pickCount.get(key) ?? 0) + 1);
      matchMapKey.set(m.id, key);
      if (season) {
        const bySid = picksBySeason.get(key) ?? new Map<number, number>();
        bySid.set(season.id, (bySid.get(season.id) ?? 0) + 1);
        picksBySeason.set(key, bySid);
      }
    }
    for (const ban of [m.shirts_ban, m.shirts_ban2, m.skins_ban1, m.skins_ban2]) {
      if (ban) {
        const key = ban.trim().toLowerCase();
        banCount.set(key, (banCount.get(key) ?? 0) + 1);
        if (season) {
          const bySid = bansBySeason.get(key) ?? new Map<number, number>();
          bySid.set(season.id, (bySid.get(season.id) ?? 0) + 1);
          bansBySeason.set(key, bySid);
        }
      }
    }
  }

  const mapPoolSeasonIds = new Map<string, Set<number>>();
  for (const s of seasons) {
    if (s.is_gauntlet) continue;
    for (const m of s.map_pool ?? []) {
      const key = m.trim().toLowerCase();
      const set = mapPoolSeasonIds.get(key) ?? new Set();
      set.add(s.id);
      mapPoolSeasonIds.set(key, set);
    }
  }

  const noPickCount = new Map<string, number>();
  const noPicksBySeason = new Map<string, Map<number, number>>();
  for (const m of matches) {
    const season = weekToSeason.get(m.week_id);
    if (!season || season.is_gauntlet || m.is_playoff_game || !isPlayedScore(m.final_score)) continue;
    if (!m.shirts_pick && !m.picked_map) continue;
    const vetoFields = [m.shirts_pick, m.picked_map, m.shirts_ban, m.shirts_ban2, m.skins_ban1, m.skins_ban2];
    const involvedKeys = new Set(vetoFields.filter((v): v is string => !!v).map((v) => v.trim().toLowerCase()));
    for (const key of mapPoolSeasonIds.keys()) {
      const poolIds = mapPoolSeasonIds.get(key)!;
      if (poolIds.has(season.id) && !involvedKeys.has(key)) {
        noPickCount.set(key, (noPickCount.get(key) ?? 0) + 1);
        const bySid = noPicksBySeason.get(key) ?? new Map<number, number>();
        bySid.set(season.id, (bySid.get(season.id) ?? 0) + 1);
        noPicksBySeason.set(key, bySid);
      }
    }
  }

  // totalKills and pickAndWon: fetch player_match_stats for played matches
  const playedMatchIds = Array.from(matchMapKey.keys());
  // match_id → season_id (for played matches)
  const matchSeasonId = new Map<number, number>();
  for (const m of matches) {
    if (!matchMapKey.has(m.id)) continue;
    const season = weekToSeason.get(m.week_id);
    if (season) matchSeasonId.set(m.id, season.id);
  }

  const totalKillsBySeason = new Map<string, Map<number, number>>();
  const totalAssistsBySeason = new Map<string, Map<number, number>>();
  const pickAndWonBySeason = new Map<string, Map<number, number>>();

  if (playedMatchIds.length > 0) {
    const { data: statsData } = await supabase
      .from('player_match_stats')
      .select('match_id, kills, assists, faction, is_win')
      .in('match_id', playedMatchIds);

    // First pass: per-match totals
    const matchKills = new Map<number, number>();
    const matchAssists = new Map<number, number>();
    const shirtsWon = new Map<number, boolean>();
    for (const s of (statsData ?? []) as { match_id: number; kills: number; assists: number; faction: string; is_win: boolean }[]) {
      matchKills.set(s.match_id, (matchKills.get(s.match_id) ?? 0) + s.kills);
      matchAssists.set(s.match_id, (matchAssists.get(s.match_id) ?? 0) + (s.assists ?? 0));
      if (s.faction === 'SHIRTS') {
        if (s.is_win) shirtsWon.set(s.match_id, true);
        else if (!shirtsWon.has(s.match_id)) shirtsWon.set(s.match_id, false);
      }
    }

    // Second pass: aggregate per map key + season
    for (const [matchId, mapKey] of matchMapKey) {
      const sid = matchSeasonId.get(matchId);
      if (sid == null) continue;
      const kills = matchKills.get(matchId) ?? 0;
      const kBySid = totalKillsBySeason.get(mapKey) ?? new Map<number, number>();
      kBySid.set(sid, (kBySid.get(sid) ?? 0) + kills);
      totalKillsBySeason.set(mapKey, kBySid);
      const assists = matchAssists.get(matchId) ?? 0;
      const aBySid = totalAssistsBySeason.get(mapKey) ?? new Map<number, number>();
      aBySid.set(sid, (aBySid.get(sid) ?? 0) + assists);
      totalAssistsBySeason.set(mapKey, aBySid);
      if (shirtsWon.get(matchId)) {
        const wBySid = pickAndWonBySeason.get(mapKey) ?? new Map<number, number>();
        wBySid.set(sid, (wBySid.get(sid) ?? 0) + 1);
        pickAndWonBySeason.set(mapKey, wBySid);
      }
    }
  }

  const mapSeasons = new Map<string, { id: number; name: string; is_gauntlet: boolean }[]>();
  for (const s of seasons) {
    for (const m of s.map_pool ?? []) {
      const key = m.trim().toLowerCase();
      const slist = mapSeasons.get(key) ?? [];
      slist.push({ id: s.id, name: s.name, is_gauntlet: s.is_gauntlet });
      mapSeasons.set(key, slist);
    }
  }

  return Array.from(canonicalName.keys()).map((key) => {
    const name = canonicalName.get(key)!;

    const allSids = new Set<number>([
      ...Array.from(picksBySeason.get(key)?.keys() ?? []),
      ...Array.from(bansBySeason.get(key)?.keys() ?? []),
      ...Array.from(noPicksBySeason.get(key)?.keys() ?? []),
      ...Array.from(totalKillsBySeason.get(key)?.keys() ?? []),
      ...Array.from(totalAssistsBySeason.get(key)?.keys() ?? []),
    ]);
    const statsBySeason = Array.from(allSids).map((sid) => ({
      seasonId: sid,
      isGauntlet: seasonById.get(sid)?.is_gauntlet ?? false,
      pickCount: picksBySeason.get(key)?.get(sid) ?? 0,
      banCount: bansBySeason.get(key)?.get(sid) ?? 0,
      noPickCount: noPicksBySeason.get(key)?.get(sid) ?? 0,
      totalKills: totalKillsBySeason.get(key)?.get(sid) ?? 0,
      totalAssists: totalAssistsBySeason.get(key)?.get(sid) ?? 0,
      pickAndWon: pickAndWonBySeason.get(key)?.get(sid) ?? 0,
    })).sort((a, b) => a.seasonId - b.seasonId);

    return {
      name,
      slug: mapSlug(name),
      pickCount: pickCount.get(key) ?? 0,
      banCount: banCount.get(key) ?? 0,
      noPickCount: noPickCount.get(key) ?? 0,
      seasons: mapSeasons.get(key) ?? [],
      statsBySeason,
    };
  }).sort((a, b) => b.pickCount - a.pickCount);
}

export async function getMapDetail(slug: string): Promise<MapDetail | null> {
  const { matches, weeks, seasons } = await fetchMapRawData();
  const canonicalName = buildCanonicalNames(matches, seasons);

  const mapName = Array.from(canonicalName.values()).find((v) => mapSlug(v) === slug);
  if (!mapName) return null;
  const nameLower = mapName.toLowerCase();

  const weekById = new Map<number, RawWeek>();
  for (const w of weeks) weekById.set(w.id, w);
  const seasonById = new Map<number, RawSeason>();
  for (const s of seasons) seasonById.set(s.id, s);

  const playedMatches = matches.filter((m) => {
    const played = (m.shirts_pick ?? m.picked_map ?? '').trim().toLowerCase();
    return played === nameLower && isPlayedScore(m.final_score);
  });

  let bans = 0;
  for (const m of matches) {
    for (const ban of [m.shirts_ban, m.shirts_ban2, m.skins_ban1, m.skins_ban2]) {
      if (ban && ban.trim().toLowerCase() === nameLower) bans++;
    }
  }

  // Seasons where this map is in the pool OR had any veto activity
  const seasonIdsSeen = new Set<number>();
  for (const s of seasons) {
    if ((s.map_pool ?? []).some((m) => m.trim().toLowerCase() === nameLower)) {
      seasonIdsSeen.add(s.id);
    }
  }
  const weekToSeasonId = new Map<number, number>();
  for (const w of weeks) weekToSeasonId.set(w.id, w.season_id);
  for (const m of matches) {
    const sid = weekToSeasonId.get(m.week_id);
    if (sid == null) continue;
    const vetoFields = [m.shirts_pick, m.picked_map, m.shirts_ban, m.shirts_ban2, m.skins_ban1, m.skins_ban2];
    if (vetoFields.some((v) => v && v.trim().toLowerCase() === nameLower)) {
      seasonIdsSeen.add(sid);
    }
  }

  const mapSeasons: { id: number; name: string; is_gauntlet: boolean }[] = [];
  for (const s of seasons) {
    if (seasonIdsSeen.has(s.id)) {
      mapSeasons.push({ id: s.id, name: s.name, is_gauntlet: s.is_gauntlet });
    }
  }

  // nopick: regular (non-gauntlet) season matches in pool seasons where this map never appeared in any veto field
  const nopickSeasonIds = new Set(
    seasons
      .filter((s) => !s.is_gauntlet && (s.map_pool ?? []).some((m) => m.trim().toLowerCase() === nameLower))
      .map((s) => s.id),
  );
  const poolWeekIds = new Set(
    weeks.filter((w) => nopickSeasonIds.has(w.season_id)).map((w) => w.id),
  );
  const involvedMatchIds = new Set<number>();
  for (const m of matches) {
    if (!poolWeekIds.has(m.week_id) || m.is_playoff_game || !isPlayedScore(m.final_score) || (!m.shirts_pick && !m.picked_map)) continue;
    const fields = [m.shirts_pick, m.picked_map, m.shirts_ban, m.shirts_ban2, m.skins_ban1, m.skins_ban2];
    if (fields.some((v) => v && v.trim().toLowerCase() === nameLower)) {
      involvedMatchIds.add(m.id);
    }
  }
  const noPickCount = matches.filter(
    (m) =>
      poolWeekIds.has(m.week_id) &&
      !m.is_playoff_game &&
      isPlayedScore(m.final_score) &&
      (m.shirts_pick != null || m.picked_map != null) &&
      !involvedMatchIds.has(m.id),
  ).length;

  if (playedMatches.length === 0) {
    return { name: mapName, slug, pickCount: 0, banCount: bans, noPickCount, seasons: mapSeasons, matches: [], playerStats: [] };
  }

  const matchIds = playedMatches.map((m) => m.id);
  const [{ data: statsData, error: sErr }, players] = await Promise.all([
    supabase.from('player_match_stats').select('*').in('match_id', matchIds),
    getPlayersById(),
  ]);
  if (sErr) throw sErr;
  const statRows = (statsData ?? []) as PlayerMatchStat[];

  const rosterByMatch = new Map<number, { shirts: MapPlayerStat[]; skins: MapPlayerStat[] }>();
  for (const s of statRows) {
    const entry = rosterByMatch.get(s.match_id) ?? { shirts: [], skins: [] };
    const player = players.get(s.player_id);
    const stat: MapPlayerStat = {
      player_id: s.player_id,
      player_name: player?.name ?? `#${s.player_id}`,
      faction: s.faction,
      kills: s.kills,
      assists: s.assists ?? 0,
      deaths: s.deaths,
      adr: s.adr ?? 0,
      damage: s.damage ?? 0,
      rounds_played: s.rounds_played ?? 0,
      rounds_won: s.rounds_won ?? 0,
      is_win: !!s.is_win,
    };
    if (s.faction === 'SHIRTS') entry.shirts.push(stat);
    else entry.skins.push(stat);
    rosterByMatch.set(s.match_id, entry);
  }

  const mapMatches: MapMatchRow[] = playedMatches
    .map((m) => {
      const week = weekById.get(m.week_id);
      if (!week) return null;
      const season = seasonById.get(week.season_id);
      if (!season) return null;
      const roster = rosterByMatch.get(m.id) ?? { shirts: [], skins: [] };
      return {
        match_id: m.id,
        match_number: m.match_number,
        week_number: week.week_number,
        season_id: season.id,
        season_number: extractSeasonNumber(season.name),
        season_name: season.name,
        is_gauntlet: season.is_gauntlet,
        is_playoff_game: m.is_playoff_game,
        final_score: m.final_score,
        shirts_stats: roster.shirts,
        skins_stats: roster.skins,
        picked_map: m.picked_map,
        shirts_pick: m.shirts_pick,
        skins_starting_side: m.skins_starting_side,
      };
    })
    .filter((r): r is MapMatchRow => r !== null)
    .sort((a, b) =>
      compareMatchRefDesc(
        { seasonNumber: a.season_number, isGauntlet: a.is_gauntlet, weekNumber: a.week_number, matchNumber: a.match_number },
        { seasonNumber: b.season_number, isGauntlet: b.is_gauntlet, weekNumber: b.week_number, matchNumber: b.match_number },
      ),
    );

  type Agg = {
    player_id: number; player_name: string;
    matches_played: number; matches_won: number; matches_lost: number;
    total_kills: number; total_assists: number; total_deaths: number;
    total_damage: number; total_rounds_played: number; total_rounds_won: number;
    kills_in_wins: number; deaths_in_wins: number;
    kills_in_losses: number; deaths_in_losses: number;
  };
  const byPlayer = new Map<number, Agg>();
  for (const s of statRows) {
    const player = players.get(s.player_id);
    if (!player) continue;
    const agg = byPlayer.get(s.player_id) ?? {
      player_id: s.player_id, player_name: player.name,
      matches_played: 0, matches_won: 0, matches_lost: 0,
      total_kills: 0, total_assists: 0, total_deaths: 0,
      total_damage: 0, total_rounds_played: 0, total_rounds_won: 0,
      kills_in_wins: 0, deaths_in_wins: 0,
      kills_in_losses: 0, deaths_in_losses: 0,
    };
    agg.matches_played += 1;
    agg.matches_won += s.is_win ? 1 : 0;
    agg.matches_lost += s.is_win ? 0 : 1;
    agg.total_kills += s.kills;
    agg.total_assists += s.assists ?? 0;
    agg.total_deaths += s.deaths;
    agg.total_damage += s.damage ?? 0;
    agg.total_rounds_played += s.rounds_played ?? 0;
    agg.total_rounds_won += s.rounds_won ?? 0;
    agg.kills_in_wins += s.is_win ? s.kills : 0;
    agg.deaths_in_wins += s.is_win ? s.deaths : 0;
    agg.kills_in_losses += s.is_win ? 0 : s.kills;
    agg.deaths_in_losses += s.is_win ? 0 : s.deaths;
    byPlayer.set(s.player_id, agg);
  }

  const playerStats: LeaderboardRowWithId[] = Array.from(byPlayer.values()).map((a) => {
    const rp = a.total_rounds_played;
    const rw = a.total_rounds_won;
    return {
      season_id: 0,
      player_id: a.player_id,
      player_name: a.player_name,
      matches_played: a.matches_played,
      matches_won: a.matches_won,
      matches_lost: a.matches_lost,
      win_rate_percentage: a.matches_played > 0 ? (a.matches_won / a.matches_played) * 100 : 0,
      total_kills: a.total_kills,
      total_assists: a.total_assists,
      total_deaths: a.total_deaths,
      kd_ratio: a.total_deaths > 0 ? a.total_kills / a.total_deaths : a.total_kills,
      total_damage: a.total_damage,
      total_rounds_played: rp,
      total_rounds_won: rw,
      rwr_percentage: rp > 0 ? (rw / rp) * 100 : 0,
      overall_adr: rp > 0 ? a.total_damage / rp : 0,
      kills_in_wins: a.kills_in_wins,
      deaths_in_wins: a.deaths_in_wins,
      kills_in_losses: a.kills_in_losses,
      deaths_in_losses: a.deaths_in_losses,
    };
  }).sort(canonicalSort);

  return { name: mapName, slug, pickCount: playedMatches.length, banCount: bans, noPickCount, seasons: mapSeasons, matches: mapMatches, playerStats };
}

// ─── H2H data layer ──────────────────────────────────────────────────────────
//
// Powers the H2H tab on the Statistics page and the match scouting report.
// Aggregated client-side (in this query function) from `player_match_stats` —
// see `design_handoff/IMPLEMENTATION_PLAN.md` Phase 2 for why no DB view is
// warranted at this league's scale.

/** A player's individual stat line for a single match. */
export interface MatchPlayerStats {
  kills: number;
  assists: number;
  deaths: number;
}

/** One match `playerA`+`playerB` played as partners (same faction). */
export interface DuoMatchSummary {
  matchId: number;
  seasonNumber: number | null;
  isGauntlet: boolean;
  weekNumber: number;
  matchNumber: number;
  map: string | null;
  score: { duo: number; opponents: number } | null;
  won: boolean | null;
  opponents: { player_id: number; player_name: string }[];
}

/** One match `playerA` and `playerB` met as opponents (different factions). */
export interface RivalMatchSummary {
  matchId: number;
  seasonNumber: number | null;
  isGauntlet: boolean;
  weekNumber: number;
  matchNumber: number;
  map: string | null;
  score: { a: number; b: number } | null;
  aWon: boolean | null;
  aMatchStats: MatchPlayerStats;
  bMatchStats: MatchPlayerStats;
}

export interface DuoStats {
  playerA: number;
  playerB: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  combinedAdr: number;
  combinedKills: number;
  combinedAssists: number;
  combinedDeaths: number;
  roundsWon: number;
  roundsPlayed: number;
  aStats: H2HPlayerStats;
  bStats: H2HPlayerStats;
  bestMap: string | null;
  matches: DuoMatchSummary[];
}

/** A player's aggregated performance across their meetings with a given rival. */
export interface H2HPlayerStats {
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  rwr: number;
  roundsWon: number;
  roundsPlayed: number;
}

export interface H2HStats {
  playerA: number;
  playerB: number;
  meetings: number;
  aWins: number;
  bWins: number;
  lastMap: string | null;
  aStats: H2HPlayerStats;
  bStats: H2HPlayerStats;
  matches: RivalMatchSummary[];
}

export interface H2HData {
  duos: DuoStats[];
  rivals: H2HStats[];
  players: { id: number; name: string; steam_avatar_url: string | null }[];
}

/**
 * Resolved season selection for H2H — mirrors how `CareerStatsView` resolves
 * `useSeasonFilter()` state, including the regular↔gauntlet career pairing,
 * so H2H's "career" mode stays consistent with the leaderboard's. Pass
 * `filter: 'career'` for the merged career view, or a regular season ID for a
 * single-season view (its paired gauntlet season is pulled in automatically
 * when `includeGauntlet` is set — same behavior as the leaderboard's season
 * dropdown).
 *
 * Note this is a flatter shape than `CareerStatsView`'s internal state: H2H
 * reads raw `player_match_stats`/`matches` rows (joined through `weeks.season_id`)
 * rather than the pre-aggregated `player_season_leaderboard` view, so it never
 * needs to merge separate regular/gauntlet aggregates — it just needs the final
 * set of season IDs to include.
 */
export interface H2HSeasonSelection {
  filter: 'career' | number;
  includeRegular: boolean;
  includeGauntlet: boolean;
  map?: string;
}

function resolveH2HSeasonIds(
  selection: H2HSeasonSelection,
  regularSeasons: Season[],
  gauntletSeasons: Season[],
  regularToGauntlet: Map<number, number>,
): Set<number> {
  const ids = new Set<number>();
  if (selection.filter === 'career') {
    if (selection.includeRegular) for (const s of regularSeasons) ids.add(s.id);
    if (selection.includeGauntlet) for (const s of gauntletSeasons) ids.add(s.id);
    return ids;
  }
  if (selection.includeRegular) ids.add(selection.filter);
  if (selection.includeGauntlet) {
    ids.add(regularToGauntlet.get(selection.filter) ?? selection.filter);
  }
  return ids;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Returns a scorer for the "Best Friends" blended metric — see "Blended score" in GLOSSARY.md.
 * Computes normalisation maxes once across `duos` then returns a closure. Shared by
 * `H2HSection` (ranking) and `H2HMatrix` (cell coloring) so both use the same formula.
 * IMPORTANT: if you change weights here, update the hover `title` in H2HSection.tsx ("Best Friends").
 */
export function duoBlendedScorer(duos: DuoStats[]): (d: DuoStats) => number {
  const eligible = duos.filter((d) => d.gamesPlayed > 0);
  const maxGames = Math.max(1, ...eligible.map((d) => d.gamesPlayed));
  const maxWinRate = Math.max(1, ...eligible.map((d) => d.wins / d.gamesPlayed));
  const maxRwr = Math.max(1, ...eligible.map((d) => winRatePct(d.roundsWon, d.roundsPlayed)));
  return (d) =>
    0.5 * (d.gamesPlayed / maxGames) ** 2 +
    0.3 * ((d.wins / d.gamesPlayed) / maxWinRate) ** 2 +
    0.2 * (winRatePct(d.roundsWon, d.roundsPlayed) / maxRwr) ** 2;
}

/**
 * Returns a scorer for the "Closest Rivals" blended metric — see "Blended score" in GLOSSARY.md.
 * Computes normalisation maxes once across `rivals` then returns a closure. Shared by
 * `H2HSection` (ranking) and `H2HMatrix` (cell coloring) so both use the same formula.
 * IMPORTANT: if you change weights here, update the hover `title` in H2HSection.tsx ("Closest Rivals" and "Best Friends").
 */
export function rivalBlendedScorer(rivals: H2HStats[]): (r: H2HStats) => number {
  const eligible = rivals.filter((r) => r.meetings > 0);
  const maxMeetings = Math.max(1, ...eligible.map((r) => r.meetings));
  const maxWinDiff = Math.max(1, ...eligible.map((r) => Math.abs(r.aWins - r.bWins)));
  const maxRoundDiff = Math.max(1, ...eligible.map((r) => Math.abs(r.aStats.roundsWon - r.bStats.roundsWon) / r.meetings));
  return (r) =>
    0.5 * (r.meetings / maxMeetings) ** 2 +
    0.3 * (1 - Math.abs(r.aWins - r.bWins) / maxWinDiff) ** 2 +
    0.2 * (1 - (Math.abs(r.aStats.roundsWon - r.bStats.roundsWon) / r.meetings) / maxRoundDiff) ** 2;
}

/** Returns a closure that formats the per-component breakdown of the friend score as a tooltip string. */
export function duoBreakdownScorer(duos: DuoStats[]): (d: DuoStats) => string {
  const eligible = duos.filter((d) => d.gamesPlayed > 0);
  const maxGames = Math.max(1, ...eligible.map((d) => d.gamesPlayed));
  const maxWinRate = Math.max(1, ...eligible.map((d) => d.wins / d.gamesPlayed));
  const maxRwr = Math.max(1, ...eligible.map((d) => winRatePct(d.roundsWon, d.roundsPlayed)));
  return (d) => {
    const games   = Math.round(0.5 * (d.gamesPlayed / maxGames) ** 2 * 100);
    const winRate = Math.round(0.3 * ((d.wins / d.gamesPlayed) / maxWinRate) ** 2 * 100);
    const rwr     = Math.round(0.2 * (winRatePct(d.roundsWon, d.roundsPlayed) / maxRwr) ** 2 * 100);
    return `Games ${games}/50 · Win rate ${winRate}/30 · Rounds ${rwr}/20`;
  };
}

/** Returns a closure that formats the per-component breakdown of the rival score as a tooltip string. */
export function rivalBreakdownScorer(rivals: H2HStats[]): (r: H2HStats) => string {
  const eligible = rivals.filter((r) => r.meetings > 0);
  const maxMeetings = Math.max(1, ...eligible.map((r) => r.meetings));
  const maxWinDiff = Math.max(1, ...eligible.map((r) => Math.abs(r.aWins - r.bWins)));
  const maxRoundDiff = Math.max(1, ...eligible.map((r) => Math.abs(r.aStats.roundsWon - r.bStats.roundsWon) / r.meetings));
  return (r) => {
    const meetings  = Math.round(0.5 * (r.meetings / maxMeetings) ** 2 * 100);
    const closeness = Math.round(0.3 * (1 - Math.abs(r.aWins - r.bWins) / maxWinDiff) ** 2 * 100);
    const rounds    = Math.round(0.2 * (1 - (Math.abs(r.aStats.roundsWon - r.bStats.roundsWon) / r.meetings) / maxRoundDiff) ** 2 * 100);
    return `Meetings ${meetings}/50 · Closeness ${closeness}/30 · Rounds ${rounds}/20`;
  };
}


interface DuoAgg {
  a: number;
  b: number;
  games: number;
  wins: number;
  losses: number;
  adrSum: number;
  kills: number;
  assists: number;
  deaths: number;
  roundsWon: number;
  roundsPlayed: number;
  aStats: RivalPlayerAgg;
  bStats: RivalPlayerAgg;
  mapTotals: Map<string, { games: number; wins: number; adrSum: number }>;
  matches: DuoMatchSummary[];
}

interface RivalPlayerAgg {
  games: number;
  kills: number;
  assists: number;
  deaths: number;
  adrSum: number;
  roundsWon: number;
  roundsPlayed: number;
}

function emptyRivalPlayerAgg(): RivalPlayerAgg {
  return { games: 0, kills: 0, assists: 0, deaths: 0, adrSum: 0, roundsWon: 0, roundsPlayed: 0 };
}

function finalizeRivalPlayerStats(agg: RivalPlayerAgg): H2HPlayerStats {
  return {
    kills: agg.kills,
    assists: agg.assists,
    deaths: agg.deaths,
    adr: agg.games > 0 ? agg.adrSum / agg.games : 0,
    rwr: agg.roundsPlayed > 0 ? (agg.roundsWon / agg.roundsPlayed) * 100 : 0,
    roundsWon: agg.roundsWon,
    roundsPlayed: agg.roundsPlayed,
  };
}

interface RivalAgg {
  a: number;
  b: number;
  meetings: number;
  aWins: number;
  bWins: number;
  aStats: RivalPlayerAgg;
  bStats: RivalPlayerAgg;
  matches: RivalMatchSummary[];
}

/**
 * The map a duo has won together most often. If multiple maps are tied for
 * the most wins, there's no clear "best" — return null rather than picking
 * one arbitrarily.
 */
function bestMapFor(mapTotals: Map<string, { games: number; wins: number; adrSum: number }>): string | null {
  let bestMap: string | null = null;
  let bestWins = -1;
  let tied = false;
  for (const [map, t] of mapTotals) {
    if (t.wins > bestWins) {
      bestMap = map;
      bestWins = t.wins;
      tied = false;
    } else if (t.wins === bestWins) {
      tied = true;
    }
  }
  return tied ? null : bestMap;
}

/**
 * Computes head-to-head relationship data — partner records (`duos`) and
 * opponent records (`rivals`) — for the given resolved season selection.
 * Only played matches count (see `isPlayedScore`).
 */
export async function getH2HData(selection: H2HSeasonSelection): Promise<H2HData> {
  const seasons = await getSeasons();
  const regularSeasons = seasons.filter((s) => !s.is_gauntlet);
  const gauntletSeasons = seasons.filter((s) => s.is_gauntlet);
  const regularToGauntlet = buildRegularToGauntletMap(regularSeasons, gauntletSeasons);
  const seasonIds = resolveH2HSeasonIds(selection, regularSeasons, gauntletSeasons, regularToGauntlet);
  if (seasonIds.size === 0) return { duos: [], rivals: [], players: [] };

  const [{ data: weeks, error: wErr }, players] = await Promise.all([
    supabase.from('weeks').select('id, season_id, week_number').in('season_id', [...seasonIds]),
    getPlayersById(),
  ]);
  if (wErr) throw wErr;
  const weekRows = (weeks ?? []) as { id: number; season_id: number; week_number: number }[];
  if (weekRows.length === 0) return { duos: [], rivals: [], players: [] };
  const weekNumberById = new Map(weekRows.map((w) => [w.id, w.week_number]));
  const seasonIdByWeek = new Map(weekRows.map((w) => [w.id, w.season_id]));
  const allSeasons = [...regularSeasons, ...gauntletSeasons];
  const seasonNumberById = new Map(allSeasons.map((s) => [s.id, extractSeasonNumber(s.name)]));
  const seasonIsGauntletById = new Map(allSeasons.map((s) => [s.id, s.is_gauntlet]));

  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, week_id, match_number, final_score, shirts_pick, picked_map')
    .in('week_id', weekRows.map((w) => w.id));
  if (mErr) throw mErr;

  type MatchRow = {
    id: number;
    week_id: number;
    match_number: number;
    final_score: string | null;
    shirts_pick: string | null;
    picked_map: string | null;
  };
  // Some seasons recorded the played map under `shirts_pick` rather than
  // `picked_map` — fall back the same way the rest of the codebase does
  // (see `getMatchById`, `getCareerMatchHistory`, etc).
  const mapFor = (m: MatchRow): string | null => m.shirts_pick ?? m.picked_map;
  const playedMatches = ((matches ?? []) as MatchRow[]).filter((m) => isPlayedScore(m.final_score));
  if (playedMatches.length === 0) return { duos: [], rivals: [], players: [] };

  const mapFilter = selection.map ? mapSlug(selection.map) : null;
  const filteredMatches = mapFilter
    ? playedMatches.filter((m) => mapSlug(mapFor(m) ?? '') === mapFilter)
    : playedMatches;

  const { data: stats, error: sErr } = await supabase
    .from('player_match_stats')
    .select('match_id, player_id, faction, kills, assists, deaths, adr, is_win, rounds_won, rounds_played')
    .in('match_id', filteredMatches.map((m) => m.id));
  if (sErr) throw sErr;

  type StatRow = {
    match_id: number;
    player_id: number;
    faction: Faction;
    kills: number;
    assists: number | null;
    deaths: number;
    adr: number;
    is_win: boolean;
    rounds_won: number;
    rounds_played: number;
  };
  const statsByMatch = new Map<number, StatRow[]>();
  for (const s of (stats ?? []) as StatRow[]) {
    const list = statsByMatch.get(s.match_id) ?? [];
    list.push(s);
    statsByMatch.set(s.match_id, list);
  }

  const duoAgg = new Map<string, DuoAgg>();
  const rivalAgg = new Map<string, RivalAgg>();
  const playerIds = new Set<number>();

  function getDuo(x: StatRow, y: StatRow): DuoAgg {
    const [a, b] = x.player_id < y.player_id ? [x.player_id, y.player_id] : [y.player_id, x.player_id];
    const key = pairKey(a, b);
    let agg = duoAgg.get(key);
    if (!agg) {
      agg = { a, b, games: 0, wins: 0, losses: 0, adrSum: 0, kills: 0, assists: 0, deaths: 0, roundsWon: 0, roundsPlayed: 0, aStats: emptyRivalPlayerAgg(), bStats: emptyRivalPlayerAgg(), mapTotals: new Map(), matches: [] };
      duoAgg.set(key, agg);
    }
    return agg;
  }

  function getRival(x: StatRow, y: StatRow): RivalAgg {
    const [a, b] = x.player_id < y.player_id ? [x.player_id, y.player_id] : [y.player_id, x.player_id];
    const key = pairKey(a, b);
    let agg = rivalAgg.get(key);
    if (!agg) {
      agg = { a, b, meetings: 0, aWins: 0, bWins: 0, aStats: emptyRivalPlayerAgg(), bStats: emptyRivalPlayerAgg(), matches: [] };
      rivalAgg.set(key, agg);
    }
    return agg;
  }

  for (const m of playedMatches) {
    const roster = statsByMatch.get(m.id) ?? [];
    if (roster.length === 0) continue;
    for (const r of roster) playerIds.add(r.player_id);

    // Partner/opponent grouping is purely faction-based: two players are
    // partners if they share a `faction` (SHIRTS/SKINS) in a match, opponents
    // if they don't. There's no explicit "duo"/"team" entity in the schema —
    // this only produces correct results because the format is always 2v2
    // Wingman. Revisit if the format ever changes.
    const shirts = roster.filter((r) => r.faction === 'SHIRTS');
    const skins = roster.filter((r) => r.faction === 'SKINS');
    const weekNumber = weekNumberById.get(m.week_id) ?? 0;
    const seasonId = seasonIdByWeek.get(m.week_id) ?? -1;
    const seasonNumber = seasonNumberById.get(seasonId) ?? null;
    const isGauntlet = seasonIsGauntletById.get(seasonId) ?? false;
    const parsedScore = parseScore(m.final_score);
    const playedMap = mapFor(m);

    const teams = [
      { roster: shirts, opponents: skins, ourScore: parsedScore?.shirts ?? null, theirScore: parsedScore?.skins ?? null },
      { roster: skins, opponents: shirts, ourScore: parsedScore?.skins ?? null, theirScore: parsedScore?.shirts ?? null },
    ];
    for (const { roster: team, opponents, ourScore, theirScore } of teams) {
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const x = team[i];
          const y = team[j];
          const agg = getDuo(x, y);
          agg.games += 1;
          if (x.is_win) agg.wins += 1;
          else agg.losses += 1;
          agg.adrSum += x.adr + y.adr;
          agg.kills += x.kills + y.kills;
          agg.assists += (x.assists ?? 0) + (y.assists ?? 0);
          agg.deaths += x.deaths + y.deaths;
          // x and y are teammates, so they share identical round totals for this match — count once.
          agg.roundsWon += x.rounds_won;
          agg.roundsPlayed += x.rounds_played;
          // Per-player stats: aStats belongs to the lower-id player (agg.a), bStats to the higher.
          const aRow = x.player_id === agg.a ? x : y;
          const bRow = aRow === x ? y : x;
          for (const [statAgg, row] of [[agg.aStats, aRow], [agg.bStats, bRow]] as const) {
            statAgg.games += 1;
            statAgg.kills += row.kills;
            statAgg.assists += row.assists ?? 0;
            statAgg.deaths += row.deaths;
            statAgg.adrSum += row.adr;
            statAgg.roundsWon += row.rounds_won;
            statAgg.roundsPlayed += row.rounds_played;
          }
          if (playedMap) {
            const mapKey = playedMap.toLowerCase();
            const mapAgg = agg.mapTotals.get(mapKey) ?? { games: 0, wins: 0, adrSum: 0 };
            mapAgg.games += 1;
            if (x.is_win) mapAgg.wins += 1;
            mapAgg.adrSum += x.adr + y.adr;
            agg.mapTotals.set(mapKey, mapAgg);
          }
          agg.matches.push({
            matchId: m.id,
            seasonNumber,
            isGauntlet,
            weekNumber,
            matchNumber: m.match_number,
            map: playedMap,
            score: ourScore != null && theirScore != null ? { duo: ourScore, opponents: theirScore } : null,
            won: x.is_win,
            opponents: opponents.map((r) => ({ player_id: r.player_id, player_name: players.get(r.player_id)?.name ?? `#${r.player_id}` })),
          });
        }
      }
    }

    for (const x of shirts) {
      for (const y of skins) {
        const agg = getRival(x, y);
        agg.meetings += 1;
        const aRow = x.player_id === agg.a ? x : y;
        const bRow = aRow === x ? y : x;
        if (aRow.is_win) agg.aWins += 1;
        else agg.bWins += 1;

        for (const [statAgg, row] of [[agg.aStats, aRow], [agg.bStats, bRow]] as const) {
          statAgg.games += 1;
          statAgg.kills += row.kills;
          statAgg.assists += row.assists ?? 0;
          statAgg.deaths += row.deaths;
          statAgg.adrSum += row.adr;
          statAgg.roundsWon += row.rounds_won;
          statAgg.roundsPlayed += row.rounds_played;
        }

        const aScore = parsedScore ? (aRow.faction === 'SHIRTS' ? parsedScore.shirts : parsedScore.skins) : null;
        const bScore = parsedScore ? (bRow.faction === 'SHIRTS' ? parsedScore.shirts : parsedScore.skins) : null;
        agg.matches.push({
          matchId: m.id,
          seasonNumber,
          isGauntlet,
          weekNumber,
          matchNumber: m.match_number,
          map: playedMap,
          score: aScore != null && bScore != null ? { a: aScore, b: bScore } : null,
          aWon: aRow.is_win,
          aMatchStats: { kills: aRow.kills, assists: aRow.assists ?? 0, deaths: aRow.deaths },
          bMatchStats: { kills: bRow.kills, assists: bRow.assists ?? 0, deaths: bRow.deaths },
        });
      }
    }
  }

  const duos: DuoStats[] = [...duoAgg.values()].map((d) => ({
    playerA: d.a,
    playerB: d.b,
    gamesPlayed: d.games,
    wins: d.wins,
    losses: d.losses,
    combinedAdr: d.games > 0 ? d.adrSum / d.games : 0,
    combinedKills: d.kills,
    combinedAssists: d.assists,
    combinedDeaths: d.deaths,
    roundsWon: d.roundsWon,
    roundsPlayed: d.roundsPlayed,
    aStats: finalizeRivalPlayerStats(d.aStats),
    bStats: finalizeRivalPlayerStats(d.bStats),
    bestMap: bestMapFor(d.mapTotals),
    matches: [...d.matches].sort(compareMatchRefDesc), // most recent first
  }));

  const rivals: H2HStats[] = [...rivalAgg.values()].map((r) => {
    const sortedMatches = [...r.matches].sort(compareMatchRefDesc); // most recent first
    return {
      playerA: r.a,
      playerB: r.b,
      meetings: r.meetings,
      aWins: r.aWins,
      bWins: r.bWins,
      lastMap: sortedMatches[0]?.map ?? null,
      aStats: finalizeRivalPlayerStats(r.aStats),
      bStats: finalizeRivalPlayerStats(r.bStats),
      matches: sortedMatches,
    };
  });

  const playerList = [...playerIds]
    .map((id) => ({
      id,
      name: players.get(id)?.name ?? `#${id}`,
      steam_avatar_url: players.get(id)?.steam_avatar_url ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { duos, rivals, players: playerList };
}

// ---------------------------------------------------------------------------
// EHOG rating data
// ---------------------------------------------------------------------------

const SUPABASE_IN_BATCH = 200;

async function batchedIn<T>(
  table: string,
  column: string,
  ids: number[],
  select: string,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += SUPABASE_IN_BATCH) {
    const chunk = ids.slice(i, i + SUPABASE_IN_BATCH);
    const { data, error } = await supabase.from(table).select(select).in(column, chunk);
    if (error) throw error;
    if (data) results.push(...(data as T[]));
  }
  return results;
}

interface MatchContext {
  matchById: Map<number, { match_number: number; week_id: number }>;
  weekById: Map<number, { season_id: number; week_number: number }>;
  seasonById: Map<number, { name: string; is_gauntlet: boolean }>;
}

async function resolveMatchContext(matchIds: number[]): Promise<MatchContext> {
  const matches = await batchedIn<{ id: number; match_number: number; week_id: number }>(
    'matches', 'id', matchIds, 'id, match_number, week_id',
  );
  const matchById = new Map(matches.map((m) => [m.id, m]));

  const weekIds = Array.from(new Set(matches.map((m) => m.week_id)));
  const weeks = await batchedIn<{ id: number; season_id: number; week_number: number }>(
    'weeks', 'id', weekIds, 'id, season_id, week_number',
  );
  const weekById = new Map(weeks.map((w) => [w.id, w]));

  const seasonIds = Array.from(new Set(weeks.map((w) => w.season_id)));
  const seasons = await batchedIn<{ id: number; name: string; is_gauntlet: boolean }>(
    'seasons', 'id', seasonIds, 'id, name, is_gauntlet',
  );
  const seasonById = new Map(seasons.map((s) => [s.id, s]));

  return { matchById, weekById, seasonById };
}

function matchSeasonInfo(
  matchId: number,
  ctx: MatchContext,
): { seasonName: string; seasonNumber: number | null; isGauntlet: boolean; weekNumber: number; matchNumber: number } {
  const m = ctx.matchById.get(matchId);
  const w = m ? ctx.weekById.get(m.week_id) : undefined;
  const s = w ? ctx.seasonById.get(w.season_id) : undefined;
  return {
    seasonName: s?.name ?? '',
    seasonNumber: s ? extractSeasonNumber(s.name) : null,
    isGauntlet: s?.is_gauntlet ?? false,
    weekNumber: w?.week_number ?? 0,
    matchNumber: m?.match_number ?? 0,
  };
}

export interface EhogRatingPoint {
  matchId: number;
  sequenceIndex: number;
  ehogRating: number;
  ratingDelta: number;
  seasonName: string;
  seasonNumber: number | null;
  isGauntlet: boolean;
  weekNumber: number;
  matchNumber: number;
}

export interface EhogPlayerData {
  currentRating: number | null;
  history: EhogRatingPoint[];
}

export async function getPlayerEhogRating(playerId: number): Promise<EhogPlayerData> {
  const [currentRes, historyRes] = await Promise.all([
    supabase
      .from('player_current_ratings')
      .select('ehog_v1')
      .eq('player_id', playerId)
      .maybeSingle(),
    supabase
      .from('player_rating_history')
      .select('match_id, sequence_index, ehog_rating, rating_delta')
      .eq('player_id', playerId)
      .eq('formula_version', 'ehog_v1')
      .order('sequence_index', { ascending: true }),
  ]);
  if (currentRes.error) throw currentRes.error;
  if (historyRes.error) throw historyRes.error;

  const currentRating: number | null = currentRes.data?.ehog_v1 ?? null;
  const rows = historyRes.data ?? [];

  if (rows.length === 0) return { currentRating, history: [] };

  const ctx = await resolveMatchContext(rows.map((r) => r.match_id));

  const history: EhogRatingPoint[] = rows.map((r) => ({
    matchId: r.match_id,
    sequenceIndex: r.sequence_index,
    ehogRating: r.ehog_rating,
    ratingDelta: correctedDelta(r.rating_delta, r.ehog_rating, r.sequence_index),
    ...matchSeasonInfo(r.match_id, ctx),
  }));

  return { currentRating, history };
}

export interface EhogSnapshotRow {
  playerId: number;
  ehogRating: number;
  sequenceIndex: number;
  seasonNumber: number | null;
  isGauntlet: boolean;
}

export async function getAllEhogSnapshots(): Promise<EhogSnapshotRow[]> {
  const { data, error } = await supabase
    .from('player_rating_history')
    .select('player_id, ehog_rating, sequence_index, match_id')
    .eq('formula_version', 'ehog_v1')
    .order('sequence_index', { ascending: true });
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const matchIds = Array.from(new Set(data.map((r) => r.match_id)));
  const ctx = await resolveMatchContext(matchIds);

  // Reduce to latest snapshot per player per (seasonNumber, isGauntlet) segment
  const latest = new Map<string, EhogSnapshotRow>();
  for (const r of data) {
    const info = matchSeasonInfo(r.match_id, ctx);
    const key = `${r.player_id}:${info.seasonNumber}:${info.isGauntlet}`;
    const prev = latest.get(key);
    if (!prev || r.sequence_index > prev.sequenceIndex) {
      latest.set(key, {
        playerId: r.player_id,
        ehogRating: r.ehog_rating,
        sequenceIndex: r.sequence_index,
        seasonNumber: info.seasonNumber,
        isGauntlet: info.isGauntlet,
      });
    }
  }
  return Array.from(latest.values());
}

export async function getSeasonEhogRatings(seasonId: number): Promise<Record<number, number>> {
  const { data: weeks, error: wErr } = await supabase
    .from('weeks')
    .select('id')
    .eq('season_id', seasonId);
  if (wErr) throw wErr;
  if (!weeks || weeks.length === 0) return {};

  const weekIds = weeks.map((w) => w.id);
  const matches = await batchedIn<{ id: number }>('matches', 'week_id', weekIds, 'id');
  if (matches.length === 0) return {};

  const matchIds = matches.map((m) => m.id);
  const rows: { player_id: number; ehog_rating: number; sequence_index: number }[] = [];
  for (let i = 0; i < matchIds.length; i += SUPABASE_IN_BATCH) {
    const chunk = matchIds.slice(i, i + SUPABASE_IN_BATCH);
    const { data, error } = await supabase
      .from('player_rating_history')
      .select('player_id, ehog_rating, sequence_index')
      .eq('formula_version', 'ehog_v1')
      .in('match_id', chunk);
    if (error) throw error;
    if (data) rows.push(...data);
  }

  const latest: Record<number, { rating: number; seq: number }> = {};
  for (const row of rows) {
    const prev = latest[row.player_id];
    if (!prev || row.sequence_index > prev.seq) {
      latest[row.player_id] = { rating: row.ehog_rating, seq: row.sequence_index };
    }
  }
  const result: Record<number, number> = {};
  for (const [pid, val] of Object.entries(latest)) result[Number(pid)] = val.rating;
  return result;
}

export async function getBatchMatchRatingDeltas(matchIds: number[]): Promise<Map<number, Map<number, number>>> {
  if (matchIds.length === 0) return new Map();
  const rows: { match_id: number; player_id: number; rating_delta: number; ehog_rating: number; sequence_index: number }[] = [];
  for (let i = 0; i < matchIds.length; i += SUPABASE_IN_BATCH) {
    const chunk = matchIds.slice(i, i + SUPABASE_IN_BATCH);
    const { data, error } = await supabase
      .from('player_rating_history')
      .select('match_id, player_id, rating_delta, ehog_rating, sequence_index')
      .in('match_id', chunk)
      .eq('formula_version', 'ehog_v1');
    if (error) throw error;
    if (data) rows.push(...data);
  }
  const result = new Map<number, Map<number, number>>();
  for (const r of rows) {
    let inner = result.get(r.match_id);
    if (!inner) { inner = new Map(); result.set(r.match_id, inner); }
    inner.set(r.player_id, correctedDelta(r.rating_delta, r.ehog_rating, r.sequence_index));
  }
  return result;
}

export async function getMatchRatingDeltas(matchId: number): Promise<Map<number, number>> {
  const { data, error } = await supabase
    .from('player_rating_history')
    .select('player_id, rating_delta, ehog_rating, sequence_index')
    .eq('match_id', matchId)
    .eq('formula_version', 'ehog_v1');
  if (error) throw error;
  const map = new Map<number, number>();
  for (const row of data ?? []) {
    map.set(row.player_id, correctedDelta(row.rating_delta, row.ehog_rating, row.sequence_index));
  }
  return map;
}

export interface PlayerMuSigma {
  playerId: number;
  mu: number;
  sigma: number;
  ehogRating: number;
}

export async function getPlayerRatings(playerIds: number[]): Promise<PlayerMuSigma[]> {
  if (playerIds.length === 0) return [];
  const rows = await batchedIn<{ player_id: number; mu: number; sigma: number; ehog_rating: number; sequence_index: number }>(
    'player_rating_history', 'player_id', playerIds,
    'player_id, mu, sigma, ehog_rating, sequence_index',
  );

  const latest = new Map<number, { mu: number; sigma: number; ehogRating: number; seq: number }>();
  for (const r of rows) {
    const prev = latest.get(r.player_id);
    if (!prev || r.sequence_index > prev.seq) {
      latest.set(r.player_id, { mu: r.mu, sigma: r.sigma, ehogRating: r.ehog_rating, seq: r.sequence_index });
    }
  }

  return playerIds.map((pid) => {
    const s = latest.get(pid);
    if (s) return { playerId: pid, mu: s.mu, sigma: s.sigma, ehogRating: s.ehogRating };
    return { playerId: pid, mu: MU_DEFAULT, sigma: SIGMA_DEFAULT, ehogRating: DEFAULT_EHOG };
  });
}
