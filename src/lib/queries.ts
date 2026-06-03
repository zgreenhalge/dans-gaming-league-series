import { supabase } from './supabase';
import { isPlayedScore } from './util';
import { mapSlug } from './maps';
import { extractSeasonNumber } from './util';
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
  season_name: string;
  map: string | null;
  final_score: string | null;
  shirts: { player_id: number; player_name: string }[];
  skins: { player_id: number; player_name: string }[];
  shirts_stats: RosterStat[];
  skins_stats: RosterStat[];
}

export interface PlayerDetail {
  player: Player;
  history: PlayerHistoryRow[];
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
}

/**
 * Aggregates assists and rounds_won from player_match_stats (both are absent
 * from the leaderboard view). Excludes playoff games. Returns a Map keyed by
 * `${season_id}:${player_id}`.
 */
async function getPerPlayerSeasonStats(): Promise<Map<string, PerPlayerStats>> {
  const [
    { data: stats, error: sErr },
    { data: matches, error: mErr },
    { data: weeks, error: wErr },
  ] = await Promise.all([
    supabase.from('player_match_stats').select('player_id, assists, rounds_won, match_id'),
    supabase.from('matches').select('id, week_id, is_playoff_game, final_score'),
    supabase.from('weeks').select('id, season_id'),
  ]);
  if (sErr) throw sErr;
  if (mErr) throw mErr;
  if (wErr) throw wErr;

  const weekToSeason = new Map<number, number>();
  for (const w of (weeks ?? []) as { id: number; season_id: number }[])
    weekToSeason.set(w.id, w.season_id);

  const seasonOfMatch = new Map<number, number>();
  for (const m of (matches ?? []) as {
    id: number;
    week_id: number;
    is_playoff_game: boolean;
    final_score: string | null;
  }[]) {
    if (m.is_playoff_game || !isPlayedScore(m.final_score)) continue;
    const sid = weekToSeason.get(m.week_id);
    if (sid != null) seasonOfMatch.set(m.id, sid);
  }

  const out = new Map<string, PerPlayerStats>();
  for (const s of (stats ?? []) as {
    player_id: number;
    assists: number | null;
    rounds_won: number | null;
    match_id: number;
  }[]) {
    const sid = seasonOfMatch.get(s.match_id);
    if (sid == null) continue;
    const key = `${sid}:${s.player_id}`;
    const prev = out.get(key) ?? { assists: 0, rounds_won: 0 };
    out.set(key, {
      assists: prev.assists + (s.assists ?? 0),
      rounds_won: prev.rounds_won + (s.rounds_won ?? 0),
    });
  }
  return out;
}

/**
 * Returns unique (season_id → Set<player_id>) for players appearing in
 * player_match_stats for matches that have NOT yet been played. Used to
 * populate zero-stat leaderboard rows for upcoming seasons.
 */
async function getRosterPlayersBySeason(): Promise<Map<number, Set<number>>> {
  const [
    { data: stats, error: sErr },
    { data: matches, error: mErr },
    { data: weeks, error: wErr },
  ] = await Promise.all([
    supabase.from('player_match_stats').select('player_id, match_id'),
    supabase.from('matches').select('id, week_id, final_score'),
    supabase.from('weeks').select('id, season_id'),
  ]);
  if (sErr) throw sErr;
  if (mErr) throw mErr;
  if (wErr) throw wErr;

  const weekToSeason = new Map<number, number>();
  for (const w of (weeks ?? []) as { id: number; season_id: number }[])
    weekToSeason.set(w.id, w.season_id);

  const unplayedMatchToSeason = new Map<number, number>();
  for (const m of (matches ?? []) as { id: number; week_id: number; final_score: string | null }[]) {
    if (!isPlayedScore(m.final_score)) {
      const sid = weekToSeason.get(m.week_id);
      if (sid != null) unplayedMatchToSeason.set(m.id, sid);
    }
  }

  const out = new Map<number, Set<number>>();
  for (const s of (stats ?? []) as { player_id: number; match_id: number }[]) {
    const sid = unplayedMatchToSeason.get(s.match_id);
    if (sid == null) continue;
    const set = out.get(sid) ?? new Set<number>();
    set.add(s.player_id);
    out.set(sid, set);
  }
  return out;
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

export async function getPlayersByName(): Promise<Map<string, Player>> {
  const { data, error } = await supabase.from('players').select('*');
  if (error) throw error;
  const map = new Map<string, Player>();
  for (const p of (data ?? []) as Player[]) map.set(p.name, p);
  return map;
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
        kills: Math.max(0, r.kills),
        assists: Math.max(0, r.assists ?? 0),
        deaths: Math.max(0, r.deaths),
        adr: Math.max(0, r.adr),
        is_win: !!r.is_win,
      }));
    const skinsStats = roster
      .filter((r) => r.faction === 'SKINS')
      .map((r) => ({
        match_id: r.match_id,
        player_id: r.player_id,
        player_name: players.get(r.player_id)?.name ?? `#${r.player_id}`,
        faction: 'SKINS' as const,
        kills: Math.max(0, r.kills),
        assists: Math.max(0, r.assists ?? 0),
        deaths: Math.max(0, r.deaths),
        adr: Math.max(0, r.adr),
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

export async function getPlayer(playerId: number): Promise<PlayerDetail | null> {
  const { data: player, error: pErr } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!player) return null;

  const { data: stats, error: sErr } = await supabase
    .from('player_match_stats')
    .select('*')
    .eq('player_id', playerId);
  if (sErr) throw sErr;
  const statRows = (stats ?? []) as PlayerMatchStat[];
  if (statRows.length === 0) {
    return { player: player as Player, history: [] };
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
      kills: Math.max(0, st.kills),
      assists: Math.max(0, st.assists ?? 0),
      deaths: Math.max(0, st.deaths),
      adr: Math.max(0, st.adr ?? 0),
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
        season_name: se.name,
        map: m.shirts_pick ?? m.picked_map,
        final_score: m.final_score,
        shirts: roster.shirts,
        skins: roster.skins,
        shirts_stats: roster.shirts_stats ?? [],
        skins_stats: roster.skins_stats ?? [],
      };
    })
    .filter((r): r is PlayerHistoryRow => r !== null && isPlayedScore(r.final_score))
    .sort(
      (a, b) =>
        b.season_id - a.season_id ||
        b.week_number - a.week_number ||
        b.match_number - a.match_number,
    );

  return { player: player as Player, history };
}

/**
 * Returns leaderboard rows for a season, augmented with player_id by joining
 * the players table by name. The view itself doesn't expose player_id.
 */
export async function getSeasonLeaderboard(
  seasonId: number,
): Promise<LeaderboardRowWithId[]> {
  const [{ data: rows, error }, playersByName, perPlayer] = await Promise.all([
    supabase
      .from('player_season_leaderboard')
      .select('*')
      .eq('season_id', seasonId)
      .order('overall_adr', { ascending: false }),
    getPlayersByName(),
    getPerPlayerSeasonStats(),
  ]);
  if (error) throw error;

  const playersById = new Map([...playersByName.values()].map((p) => [p.id, p]));

  const result = ((rows ?? []) as LeaderboardRow[]).map((r) => {
    const player_id = playersByName.get(r.player_name)?.id ?? -1;
    const ps = perPlayer.get(`${r.season_id}:${player_id}`);
    const total_rounds_played = n(r.total_rounds_played);
    const total_rounds_won = ps?.rounds_won ?? 0;
    return {
      ...normalizeRow(r),
      player_id,
      total_assists: ps?.assists ?? 0,
      total_rounds_won,
      rwr_percentage: total_rounds_played > 0 ? (total_rounds_won / total_rounds_played) * 100 : 0,
    };
  });

  if (result.length > 0) return result;

  // No played matches yet — fall back to roster players with zero stats
  const rosterBySeason = await getRosterPlayersBySeason();
  const rosterIds = rosterBySeason.get(seasonId);
  if (!rosterIds?.size) return [];
  return zeroStatRows(seasonId, rosterIds, playersById);
}

/**
 * Career leaderboard — sums per-season leaderboard rows across all seasons,
 * skipping rows with no rounds played (S3 placeholder rows). K/D and ADR
 * are re-derived from totals so the math stays correct.
 */
export async function getCareerLeaderboard(): Promise<LeaderboardRowWithId[]> {
  const [{ data: rows, error }, players, perPlayer] = await Promise.all([
    supabase.from('player_season_leaderboard').select('*'),
    getPlayersByName(),
    getPerPlayerSeasonStats(),
  ]);
  if (error) throw error;

  type Agg = {
    matches_played: number;
    matches_won: number;
    matches_lost: number;
    total_kills: number;
    total_assists: number;
    total_deaths: number;
    total_damage: number;
    total_rounds_played: number;
    total_rounds_won: number;
    seasons: Set<number>;
  };
  const byName = new Map<string, Agg>();
  for (const raw of (rows ?? []) as LeaderboardRow[]) {
    const r = normalizeRow(raw);
    if (r.total_rounds_played === 0) continue; // skip unplayed (S3 placeholder)
    const player_id = players.get(r.player_name)?.id ?? -1;
    const agg =
      byName.get(r.player_name) ??
      ({
        matches_played: 0,
        matches_won: 0,
        matches_lost: 0,
        total_kills: 0,
        total_assists: 0,
        total_deaths: 0,
        total_damage: 0,
        total_rounds_played: 0,
        total_rounds_won: 0,
        seasons: new Set<number>(),
      } as Agg);
    const ps = perPlayer.get(`${r.season_id}:${player_id}`);
    agg.matches_played += r.matches_played;
    agg.matches_won += r.matches_won;
    agg.matches_lost += r.matches_lost;
    agg.total_kills += r.total_kills;
    agg.total_assists += ps?.assists ?? 0;
    agg.total_deaths += r.total_deaths;
    agg.total_damage += r.total_damage;
    agg.total_rounds_played += r.total_rounds_played;
    agg.total_rounds_won += ps?.rounds_won ?? 0;
    agg.seasons.add(r.season_id);
    byName.set(r.player_name, agg);
  }

  const out: LeaderboardRowWithId[] = [];
  for (const [player_name, a] of byName) {
    out.push({
      season_id: 0,
      player_name,
      player_id: players.get(player_name)?.id ?? -1,
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
    });
  }
  return out.sort((a, b) => b.overall_adr - a.overall_adr);
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
  };
}

/**
 * Aggregates stats from all gauntlet seasons (is_gauntlet = true).
 * The leaderboard view excludes playoff games, so we compute directly from
 * player_match_stats. Negative sentinel values (-1) are clamped to 0.
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
    };
    agg.matches_played += 1;
    agg.matches_won += s.is_win ? 1 : 0;
    agg.matches_lost += s.is_win ? 0 : 1;
    agg.total_kills += Math.max(0, s.kills);
    agg.total_assists += Math.max(0, s.assists);
    agg.total_deaths += Math.max(0, s.deaths);
    agg.total_damage += Math.max(0, s.damage);
    agg.total_rounds_played += Math.max(0, s.rounds_played);
    agg.total_rounds_won += Math.max(0, s.rounds_won);
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
    }
    careerByPlayer.set(agg.player_id, prev);
  }

  for (const sid of Object.keys(bySeason))
    bySeason[Number(sid)].sort((a, b) => b.overall_adr - a.overall_adr);

  const career = Array.from(careerByPlayer.values())
    .map((agg) => aggToRow(agg, 0))
    .sort((a, b) => b.overall_adr - a.overall_adr);

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
  map: string | null;
  final_score: string | null;
  shirts: GauntletPlayerStat[];
  skins: GauntletPlayerStat[];
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
    };
    agg.matches_played += 1;
    agg.matches_won += s.is_win ? 1 : 0;
    agg.matches_lost += s.is_win ? 0 : 1;
    agg.total_kills += Math.max(0, s.kills);
    agg.total_assists += Math.max(0, s.assists);
    agg.total_deaths += Math.max(0, s.deaths);
    agg.total_damage += Math.max(0, s.damage);
    agg.total_rounds_played += Math.max(0, s.rounds_played);
    agg.total_rounds_won += Math.max(0, s.rounds_won);
    byPlayer.set(s.player_id, agg);
  }

  return Array.from(byPlayer.values())
    .map((agg) => ({
      ...aggToRow(agg, seasonId),
      steam_avatar_url: players.get(agg.player_id)?.steam_avatar_url ?? null,
    }))
    .sort((a, b) => b.overall_adr - a.overall_adr);
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
      kills: Math.max(0, s.kills),
      assists: Math.max(0, s.assists ?? 0),
      deaths: Math.max(0, s.deaths),
      adr: Math.max(0, s.adr),
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
        map: m.shirts_pick ?? m.picked_map,
        final_score: m.final_score,
        shirts: allStats.filter((s) => s.faction === 'SHIRTS'),
        skins: allStats.filter((s) => s.faction === 'SKINS'),
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
  season_name: string;
  is_gauntlet: boolean;
  is_playoff_game: boolean;
  final_score: string | null;
  shirts_stats: MapPlayerStat[];
  skins_stats: MapPlayerStat[];
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

/** Returns leaderboards for every season, keyed by season_id. */
export async function getAllLeaderboards(): Promise<
  Map<number, LeaderboardRowWithId[]>
> {
  const [{ data: rows, error }, playersByName, perPlayer, rosterBySeason] = await Promise.all([
    supabase
      .from('player_season_leaderboard')
      .select('*')
      .order('overall_adr', { ascending: false }),
    getPlayersByName(),
    getPerPlayerSeasonStats(),
    getRosterPlayersBySeason(),
  ]);
  if (error) throw error;

  const playersById = new Map([...playersByName.values()].map((p) => [p.id, p]));

  const out = new Map<number, LeaderboardRowWithId[]>();
  for (const r of (rows ?? []) as LeaderboardRow[]) {
    const player_id = playersByName.get(r.player_name)?.id ?? -1;
    const ps = perPlayer.get(`${r.season_id}:${player_id}`);
    const total_rounds_played = n(r.total_rounds_played);
    const total_rounds_won = ps?.rounds_won ?? 0;
    const withId: LeaderboardRowWithId = {
      ...normalizeRow(r),
      player_id,
      total_assists: ps?.assists ?? 0,
      total_rounds_won,
      rwr_percentage: total_rounds_played > 0 ? (total_rounds_won / total_rounds_played) * 100 : 0,
    };
    const list = out.get(r.season_id) ?? [];
    list.push(withId);
    out.set(r.season_id, list);
  }

  // For any season with roster players but no played matches, add zero-stat rows
  for (const [seasonId, playerIds] of rosterBySeason) {
    if (!out.has(seasonId)) {
      out.set(seasonId, zeroStatRows(seasonId, playerIds, playersById));
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
      supabase.from('matches').select('id, week_id, match_number, final_score, shirts_pick, picked_map, shirts_ban, shirts_ban2, skins_ban1, skins_ban2, is_playoff_game'),
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
      matchKills.set(s.match_id, (matchKills.get(s.match_id) ?? 0) + Math.max(0, s.kills));
      matchAssists.set(s.match_id, (matchAssists.get(s.match_id) ?? 0) + Math.max(0, s.assists ?? 0));
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
      kills: Math.max(0, s.kills),
      assists: Math.max(0, s.assists ?? 0),
      deaths: Math.max(0, s.deaths),
      adr: Math.max(0, s.adr ?? 0),
      damage: Math.max(0, s.damage ?? 0),
      rounds_played: Math.max(0, s.rounds_played ?? 0),
      rounds_won: Math.max(0, s.rounds_won ?? 0),
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
        season_name: season.name,
        is_gauntlet: season.is_gauntlet,
        is_playoff_game: m.is_playoff_game,
        final_score: m.final_score,
        shirts_stats: roster.shirts,
        skins_stats: roster.skins,
      };
    })
    .filter((r): r is MapMatchRow => r !== null)
    .sort((a, b) => b.season_id - a.season_id || b.week_number - a.week_number || b.match_number - a.match_number);

  type Agg = {
    player_id: number; player_name: string;
    matches_played: number; matches_won: number; matches_lost: number;
    total_kills: number; total_assists: number; total_deaths: number;
    total_damage: number; total_rounds_played: number; total_rounds_won: number;
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
    };
    agg.matches_played += 1;
    agg.matches_won += s.is_win ? 1 : 0;
    agg.matches_lost += s.is_win ? 0 : 1;
    agg.total_kills += Math.max(0, s.kills);
    agg.total_assists += Math.max(0, s.assists ?? 0);
    agg.total_deaths += Math.max(0, s.deaths);
    agg.total_damage += Math.max(0, s.damage ?? 0);
    agg.total_rounds_played += Math.max(0, s.rounds_played ?? 0);
    agg.total_rounds_won += Math.max(0, s.rounds_won ?? 0);
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
    };
  }).sort((a, b) => b.overall_adr - a.overall_adr);

  return { name: mapName, slug, pickCount: playedMatches.length, banCount: bans, noPickCount, seasons: mapSeasons, matches: mapMatches, playerStats };
}
