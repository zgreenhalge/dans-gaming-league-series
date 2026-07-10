import { gunzipMaybe } from './gzip';
import { supabase } from './supabase';
import { getR2Object, replayKey, heatmapKey, demoResultKey } from './r2';
import type { ReplayPayload, ReplayPlayerMeta, ReplayEvent } from './replay/types';
import type { HeatmapArtifact, HeatmapKind } from './replay/heatmap';
import { isPlayedScore, winRatePct, avgOf } from './util';
import { mapSlug } from './maps';
import { workshopIdFromUrl } from './replay/radar';
import { extractSeasonNumber, buildRegularToGauntletMap, canonicalSort, compareMatchRefDesc, matchLabel, weekWindow, computeH2H, resolveH2HPickedBy } from './util';
import type { DuoStats, H2HStats, H2HData, H2HMatchInput } from './util';
import { MU_DEFAULT, SIGMA_DEFAULT, DEFAULT_EHOG, fromEhog } from './ehog';
import { DEMO_INGEST_JOB_TYPE, type DemoIngestResult } from './demo/ingestResult';
import {
  BACKGROUND_JOB_TYPES,
  type BackgroundJobType,
  type BackgroundJobSubject,
  type BackgroundJobRow,
} from './jobs';
import type { ScheduledMatchRef } from './schedule';
import type { OpsErrorEntityType } from './ops-errors';
import type {
  Season,
  Week,
  Match,
  Player,
  PlayerMatchStat,
  PlayerMatchSabremetrics,
  SabFields,
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

/**
 * Other unplayed matches that have a scheduled time — used to warn (and link) when a match is
 * scheduled close to another, since they'd contend for the single shared DatHost server (#134).
 * Played matches are excluded (their scheduled time is moot).
 */
export async function getOtherScheduledMatches(matchId: number): Promise<ScheduledMatchRef[]> {
  const { data } = await supabase
    .from('matches')
    .select('id, match_number, scheduled_at, final_score, weeks(week_number, seasons(name))')
    .not('scheduled_at', 'is', null)
    .neq('id', matchId);
  type Row = {
    id: number;
    match_number: number | null;
    scheduled_at: string | null;
    final_score: string | null;
    weeks: { week_number: number | null; seasons: { name: string | null } | null } | null;
  };
  // Supabase types embedded to-one relations as arrays, but returns objects at runtime — cast through
  // unknown (same pattern as other nested selects here).
  const rows = (data ?? []) as unknown as Row[];
  return rows
    .filter((r) => r.scheduled_at && !isPlayedScore(r.final_score))
    .map((r) => ({
      id: r.id,
      scheduledAt: r.scheduled_at as string,
      label: matchLabel({
        matchId: r.id,
        seasonName: r.weeks?.seasons?.name,
        weekNumber: r.weeks?.week_number,
        matchNumber: r.match_number,
      }),
    }));
}

/** One row of the admin match-management console (#144) — a full match plus the context its editors
 *  (reschedule, clear/redo pick-ban, feature toggle) need. */
export interface AdminMatchRow {
  match: Match;
  label: string;
  seasonNumber: number | null;
  weekNumber: number | null;
  isGauntlet: boolean;
  mapPool: string[] | null;
  /** Week window (yyyy-mm-dd) for the schedule editor's out-of-window warning; null if undated. */
  weekStart: string | null;
  weekEnd: string | null;
}

/**
 * Every match with the context the admin match console (#144) needs to reschedule, clear/redo the
 * pick-ban, or toggle the feature flag: the full row plus season/week labels, map pool, gauntlet flag,
 * and week window. Sorted newest (season → week → match) first — same canonical order as the rest of
 * the site. Admin-only surface; the page gates access.
 */
export async function getAdminMatches(): Promise<AdminMatchRow[]> {
  const { data, error } = await supabase
    .from('matches')
    .select('*, weeks(week_number, seasons(name, is_gauntlet, map_pool, start_date))');
  if (error || !data) return [];

  type Row = Match & {
    weeks: {
      week_number: number | null;
      seasons: {
        name: string | null;
        is_gauntlet: boolean | null;
        map_pool: string[] | null;
        start_date: string | null;
      } | null;
    } | null;
  };
  // Supabase types embedded to-one relations as arrays but returns objects at runtime (same cast as
  // getOtherScheduledMatches above).
  const rows = data as unknown as Row[];

  const out = rows.map((r): AdminMatchRow => {
    const { weeks, ...match } = r;
    const season = weeks?.seasons ?? null;
    const weekNumber = weeks?.week_number ?? null;
    const win =
      season?.start_date && weekNumber != null ? weekWindow(season.start_date, weekNumber) : null;
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return {
      match: match as Match,
      label: matchLabel({
        matchId: r.id,
        seasonName: season?.name ?? null,
        weekNumber,
        matchNumber: r.match_number,
      }),
      seasonNumber: season?.name ? extractSeasonNumber(season.name) : null,
      weekNumber,
      isGauntlet: season?.is_gauntlet ?? false,
      mapPool: season?.map_pool ?? null,
      weekStart: win ? fmt(win.start) : null,
      weekEnd: win ? fmt(win.end) : null,
    };
  });

  out.sort((a, b) =>
    compareMatchRefDesc(
      { seasonNumber: a.seasonNumber, isGauntlet: a.isGauntlet, weekNumber: a.weekNumber ?? 0, matchNumber: a.match.match_number ?? 0 },
      { seasonNumber: b.seasonNumber, isGauntlet: b.isGauntlet, weekNumber: b.weekNumber ?? 0, matchNumber: b.match.match_number ?? 0 },
    ),
  );
  return out;
}

/**
 * All players for the admin player console (#144), sorted by display name. Returns the full `Player`
 * row (name, `is_admin`, and the steam-link fields) so the console can edit them in place.
 */
export async function getAdminPlayers(): Promise<Player[]> {
  const { data, error } = await supabase.from('players').select('*').order('name');
  if (error || !data) return [];
  return data as Player[];
}

export interface MatchSabremetricsRow extends PlayerMatchSabremetrics {
  player_id: number;
  player_name: string;
  faction: Faction;
}

export async function getMatchSabremetrics(matchId: number): Promise<MatchSabremetricsRow[]> {
  const { data: pmsRows } = await supabase
    .from('player_match_stats')
    .select('id, player_id, faction')
    .eq('match_id', matchId);
  if (!pmsRows || pmsRows.length === 0) return [];

  const pmsIds = (pmsRows as { id: number; player_id: number; faction: string }[]).map((r) => r.id);
  const { data: sabRows } = await supabase
    .from('player_match_sabremetrics')
    .select('*')
    .in('player_match_stats_id', pmsIds);
  if (!sabRows || sabRows.length === 0) return [];

  const players = await getPlayersById();
  const pmsLookup = new Map(
    (pmsRows as { id: number; player_id: number; faction: string }[]).map((r) => [r.id, r]),
  );

  return (sabRows as PlayerMatchSabremetrics[]).map((sab) => {
    const pms = pmsLookup.get(sab.player_match_stats_id)!;
    return {
      ...sab,
      player_id: pms.player_id,
      player_name: players.get(pms.player_id)?.name ?? `#${pms.player_id}`,
      faction: pms.faction as Faction,
    };
  });
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
  /** The pod this match belongs to — null for gauntlets predating the bracket-scheduling feature
   * (historical CSV imports), which have no `gauntlet_pods` rows at all. */
  pod_index: number | null;
  advance_rule: 'single' | 'wildcard' | null;
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

/** The gauntlet pod a match belongs to, if any — null for non-gauntlet matches and for gauntlets
 * predating the bracket-scheduling feature (no gauntlet_pods rows). Used to show the pod stakes
 * label on the match detail page. */
export async function getGauntletPodForMatch(
  matchId: number,
): Promise<{ advance_rule: 'single' | 'wildcard'; is_final: boolean } | null> {
  const { data, error } = await supabase
    .from('gauntlet_pods')
    .select('advance_rule, is_final')
    .or(`match1_id.eq.${matchId},match2_id.eq.${matchId}`)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as { advance_rule: 'single' | 'wildcard'; is_final: boolean } | null;
}

export interface BracketSlot {
  slot_index: number;
  source_kind: 'seed' | 'pod';
  /** The initial tournament seed this slot is filled from, once assigned — set only for
   * `source_kind = 'seed'` slots, and only for the round they first appear in (round 1, or later
   * for a bye). */
  source_seed: number | null;
  /** The earlier pod this slot's occupant advances from — set only for `source_kind = 'pod'`
   * slots. Draws the connector line between pods in `GauntletBracketDiagram`. */
  source_pod_id: number | null;
  player_id: number | null;
  player_name: string | null;
}

export interface BracketPod {
  id: number;
  round_number: number;
  pod_index: number;
  advance_rule: 'single' | 'wildcard';
  is_final: boolean;
  /** True once every match this pod has materialized is played. False for an unmaterialized pod
   * (no matches yet) as well as one still in progress. */
  played: boolean;
  /** True once this pod's matches exist (`match1_id` set), whether or not they're played yet — the
   * manual pod editor (`GauntletPodEditor`) locks a pod against further editing/deletion from this
   * point on, since its scheduling is real. */
  materialized: boolean;
  slots: BracketSlot[];
}

/** The full bracket shape — every pod and slot for a gauntlet season, whether or not it's been
 * seeded or played yet. Unlike `getGauntletRounds()` (which reads matches, and so returns nothing
 * until a pod materializes), this reads `gauntlet_pods`/`gauntlet_pod_slots` directly, so it also
 * covers the persisted-but-unseeded shape (`GauntletBracketDiagram`'s empty-state preview) and lets
 * the diagram trace each pod's advancement source (`source_pod_id`) across rounds regardless of
 * play progress. Returns `[]` for a gauntlet with no pods at all yet. */
export async function getGauntletBracketShape(gauntletSeasonId: number): Promise<BracketPod[]> {
  const { data: podRows, error: podErr } = await supabase
    .from('gauntlet_pods')
    .select('id, round_number, pod_index, advance_rule, is_final, match1_id, match2_id')
    .eq('season_id', gauntletSeasonId)
    .order('round_number', { ascending: true })
    .order('pod_index', { ascending: true });
  if (podErr) throw podErr;
  type PodRow = {
    id: number;
    round_number: number;
    pod_index: number;
    advance_rule: 'single' | 'wildcard';
    is_final: boolean;
    match1_id: number | null;
    match2_id: number | null;
  };
  const pods = (podRows ?? []) as PodRow[];
  if (pods.length === 0) return [];

  const podIds = pods.map((p) => p.id);
  const matchIds = pods.flatMap((p) => [p.match1_id, p.match2_id]).filter((id): id is number => id != null);

  const [{ data: slotRows, error: slotErr }, { data: matchRows }, players] = await Promise.all([
    supabase
      .from('gauntlet_pod_slots')
      .select('pod_id, slot_index, source_kind, source_seed, source_pod_id, player_id')
      .in('pod_id', podIds),
    matchIds.length
      ? supabase.from('matches').select('id, final_score').in('id', matchIds)
      : Promise.resolve({ data: [] as { id: number; final_score: string | null }[] }),
    getPlayersById(),
  ]);
  if (slotErr) throw slotErr;

  const playedMatch = new Map(
    ((matchRows ?? []) as { id: number; final_score: string | null }[]).map((m) => [m.id, isPlayedScore(m.final_score)]),
  );

  type SlotRow = {
    pod_id: number;
    slot_index: number;
    source_kind: 'seed' | 'pod';
    source_seed: number | null;
    source_pod_id: number | null;
    player_id: number | null;
  };
  const slotsByPod = new Map<number, BracketSlot[]>();
  for (const row of (slotRows ?? []) as SlotRow[]) {
    const list = slotsByPod.get(row.pod_id) ?? [];
    list.push({
      slot_index: row.slot_index,
      source_kind: row.source_kind,
      source_seed: row.source_seed,
      source_pod_id: row.source_pod_id,
      player_id: row.player_id,
      player_name: row.player_id != null ? (players.get(row.player_id)?.name ?? null) : null,
    });
    slotsByPod.set(row.pod_id, list);
  }

  return pods.map((p) => {
    const podMatchIds = [p.match1_id, p.match2_id].filter((id): id is number => id != null);
    return {
      id: p.id,
      round_number: p.round_number,
      pod_index: p.pod_index,
      advance_rule: p.advance_rule,
      is_final: p.is_final,
      played: podMatchIds.length > 0 && podMatchIds.every((id) => playedMatch.get(id) === true),
      materialized: p.match1_id != null,
      slots: (slotsByPod.get(p.id) ?? []).sort((a, b) => a.slot_index - b.slot_index),
    };
  });
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
  const [{ data: stats, error: sErr }, players, { data: pods, error: pErr }] = await Promise.all([
    supabase
      .from('player_match_stats')
      .select('match_id, player_id, faction, kills, assists, deaths, adr, is_win')
      .in('match_id', matchIds),
    getPlayersById(),
    supabase
      .from('gauntlet_pods')
      .select('pod_index, advance_rule, match1_id, match2_id')
      .eq('season_id', seasonId),
  ]);
  if (sErr) throw sErr;
  if (pErr) throw pErr;

  // Absent for gauntlets predating the bracket-scheduling feature (historical CSV imports have no
  // gauntlet_pods rows at all) — GauntletMatch.pod_index/advance_rule stay null for those.
  const podByMatchId = new Map<number, { pod_index: number; advance_rule: 'single' | 'wildcard' }>();
  for (const p of (pods ?? []) as { pod_index: number; advance_rule: 'single' | 'wildcard'; match1_id: number | null; match2_id: number | null }[]) {
    if (p.match1_id != null) podByMatchId.set(p.match1_id, { pod_index: p.pod_index, advance_rule: p.advance_rule });
    if (p.match2_id != null) podByMatchId.set(p.match2_id, { pod_index: p.pod_index, advance_rule: p.advance_rule });
  }

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
      const pod = podByMatchId.get(m.id) ?? null;
      return {
        id: m.id,
        match_number: m.match_number,
        final_score: m.final_score,
        picked_map: m.picked_map,
        shirts_pick: m.shirts_pick,
        skins_starting_side: m.skins_starting_side,
        shirts_stats: allStats.filter((s) => s.faction === 'SHIRTS'),
        skins_stats: allStats.filter((s) => s.faction === 'SKINS'),
        pod_index: pod?.pod_index ?? null,
        advance_rule: pod?.advance_rule ?? null,
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
// Powers the H2H tab on the Statistics page, the Map detail page, and the
// match scouting report. The aggregation core (`computeH2H`) lives in
// `util.ts` — client-bundle-safe (no supabase import) — so the Statistics and
// Map pages, which already load full match history client-side for their
// other tabs, can compute H2H directly from it and honor a live season filter
// instead of a static server-fetched snapshot. `getH2HData` below is the
// DB-backed entry point for pages that don't already hold that data (player
// page, season page, match scouting) — see `docs/patterns.md` re: extracting
// shared aggregation logic instead of duplicating it.
//
// Types re-exported here for backward compatibility with existing imports.
export type {
  MatchRosterPlayer,
  DuoMatchSummary,
  RivalMatchSummary,
  DuoStats,
  H2HPlayerStats,
  H2HStats,
  H2HMapStat,
  H2HData,
} from './util';

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

/**
 * Returns a scorer for the "Best Friends" blended metric — see "Blended score" in docs/glossary.md.
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
 * Returns a scorer for the "Closest Rivals" blended metric — see "Blended score" in docs/glossary.md.
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


/**
 * Computes head-to-head relationship data — partner records (`duos`) and
 * opponent records (`rivals`) — for the given resolved season selection.
 * Only played matches count (see `isPlayedScore`). Fetches the raw match/stat
 * rows and delegates the actual aggregation to `computeH2H` (util.ts).
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
    .select('id, week_id, match_number, final_score, shirts_pick, picked_map, skins_starting_side')
    .in('week_id', weekRows.map((w) => w.id));
  if (mErr) throw mErr;

  type MatchRow = {
    id: number;
    week_id: number;
    match_number: number;
    final_score: string | null;
    shirts_pick: string | null;
    picked_map: string | null;
    skins_starting_side: 'CT' | 'T' | null;
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

  const matchInputs: H2HMatchInput[] = [];
  for (const m of filteredMatches) {
    const roster = statsByMatch.get(m.id) ?? [];
    if (roster.length === 0) continue;
    const seasonId = seasonIdByWeek.get(m.week_id) ?? -1;
    matchInputs.push({
      matchId: m.id,
      weekNumber: weekNumberById.get(m.week_id) ?? 0,
      matchNumber: m.match_number,
      seasonNumber: seasonNumberById.get(seasonId) ?? null,
      isGauntlet: seasonIsGauntletById.get(seasonId) ?? false,
      map: mapFor(m),
      pickedBy: resolveH2HPickedBy(m.shirts_pick, m.picked_map),
      startingSide: m.skins_starting_side,
      finalScore: m.final_score,
      roster: roster.map((r) => ({
        player_id: r.player_id,
        faction: r.faction,
        kills: r.kills,
        assists: r.assists ?? 0,
        deaths: r.deaths,
        adr: r.adr,
        is_win: r.is_win,
        rounds_won: r.rounds_won,
        rounds_played: r.rounds_played,
      })),
    });
  }

  return computeH2H(matchInputs, players);
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
    ratingDelta: r.rating_delta,
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
    inner.set(r.player_id, r.rating_delta);
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
    map.set(row.player_id, row.rating_delta);
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

  // Players with no rating_history yet may still have a configured seed_ehog (a known new
  // player's starting rating) — use that instead of the global default for their preview.
  const unratedIds = playerIds.filter((pid) => !latest.has(pid));
  const seedRows = unratedIds.length > 0
    ? await batchedIn<{ id: number; seed_ehog: number | null }>('players', 'id', unratedIds, 'id, seed_ehog')
    : [];
  const seedByPlayer = new Map(
    seedRows.filter((r) => r.seed_ehog != null).map((r) => [r.id, r.seed_ehog as number]),
  );

  return playerIds.map((pid) => {
    const s = latest.get(pid);
    if (s) return { playerId: pid, mu: s.mu, sigma: s.sigma, ehogRating: s.ehogRating };
    const seedEhog = seedByPlayer.get(pid);
    if (seedEhog != null) {
      return { playerId: pid, mu: fromEhog(seedEhog, SIGMA_DEFAULT), sigma: SIGMA_DEFAULT, ehogRating: seedEhog };
    }
    return { playerId: pid, mu: MU_DEFAULT, sigma: SIGMA_DEFAULT, ehogRating: DEFAULT_EHOG };
  });
}

export interface SabremetricMatchRow {
  player_id: number;
  player_name: string;
  match_id: number;
  season_id: number;
  is_gauntlet: boolean;
  rounds_played: number;
  sab: SabFields;
}

/** All sabremetrics, or (with `seasonId`) just one season's — same join, filtered at the end so
 *  season-scoped callers (the season page) can't drift from the career-wide one. */
export async function getAllSabremetrics(seasonId?: number): Promise<SabremetricMatchRow[]> {
  const [
    { data: sabRows, error: sabErr },
    { data: pmsRows, error: pmsErr },
    { data: matchRows, error: matchErr },
    { data: weekRows, error: weekErr },
    { data: seasonRows, error: seasonErr },
    playersById,
  ] = await Promise.all([
    supabase.from('player_match_sabremetrics').select('*'),
    supabase.from('player_match_stats').select('id, player_id, match_id, rounds_played'),
    supabase.from('matches').select('id, week_id, final_score'),
    supabase.from('weeks').select('id, season_id'),
    supabase.from('seasons').select('id, is_gauntlet'),
    getPlayersById(),
  ]);
  if (sabErr) throw sabErr;
  if (pmsErr) throw pmsErr;
  if (matchErr) throw matchErr;
  if (weekErr) throw weekErr;
  if (seasonErr) throw seasonErr;

  const weekToSeason = new Map<number, number>();
  for (const w of (weekRows ?? []) as { id: number; season_id: number }[])
    weekToSeason.set(w.id, w.season_id);

  const seasonIsGauntlet = new Map<number, boolean>();
  for (const s of (seasonRows ?? []) as { id: number; is_gauntlet: boolean }[])
    seasonIsGauntlet.set(s.id, s.is_gauntlet);

  const matchSeason = new Map<number, number>();
  for (const m of (matchRows ?? []) as { id: number; week_id: number; final_score: string | null }[]) {
    if (!isPlayedScore(m.final_score)) continue;
    const sid = weekToSeason.get(m.week_id);
    if (sid != null) matchSeason.set(m.id, sid);
  }

  const pmsLookup = new Map<number, { player_id: number; match_id: number; rounds_played: number }>();
  for (const r of (pmsRows ?? []) as { id: number; player_id: number; match_id: number; rounds_played: number }[])
    pmsLookup.set(r.id, r);

  const result: SabremetricMatchRow[] = [];
  for (const raw of (sabRows ?? []) as PlayerMatchSabremetrics[]) {
    const pms = pmsLookup.get(raw.player_match_stats_id);
    if (!pms) continue;
    const sid = matchSeason.get(pms.match_id);
    if (sid == null) continue;
    if (seasonId != null && sid !== seasonId) continue;
    const player = playersById.get(pms.player_id);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { player_match_stats_id: _, ...sab } = raw;
    result.push({
      player_id: pms.player_id,
      player_name: player?.name ?? `#${pms.player_id}`,
      match_id: pms.match_id,
      season_id: sid,
      is_gauntlet: seasonIsGauntlet.get(sid) ?? false,
      rounds_played: pms.rounds_played,
      sab,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Admin check
// ---------------------------------------------------------------------------

export async function isPlayerAdmin(playerId: number): Promise<boolean> {
  const { data } = await supabase
    .from('players')
    .select('is_admin')
    .eq('id', playerId)
    .maybeSingle();
  return !!(data as { is_admin?: boolean } | null)?.is_admin;
}

// ---------------------------------------------------------------------------
// Maps table lookup
// ---------------------------------------------------------------------------

export type MapRow = {
  id: number;
  name: string;
  slug: string;
  workshop_url: string | null;
  image_url: string | null;
};

export async function getMapLookup(): Promise<Record<string, { image_url: string | null; workshop_url: string | null }>> {
  const { data, error } = await supabase.from('maps').select('*');
  if (error) throw error;
  const lookup: Record<string, { image_url: string | null; workshop_url: string | null }> = {};
  for (const row of (data ?? []) as MapRow[]) {
    lookup[row.slug] = { image_url: row.image_url, workshop_url: row.workshop_url };
  }
  return lookup;
}

export interface WorkshopMapOption {
  name: string;
  workshopId: string;
}

/** Maps with a resolvable workshop id, for a workshop-map picker (e.g. the admin server console). */
export async function getMapsForWorkshopPicker(): Promise<WorkshopMapOption[]> {
  const { data, error } = await supabase.from('maps').select('name, workshop_url').order('name');
  if (error) throw error;
  const rows = (data ?? []) as { name: string; workshop_url: string | null }[];
  const options: WorkshopMapOption[] = [];
  for (const row of rows) {
    const workshopId = workshopIdFromUrl(row.workshop_url);
    if (workshopId) options.push({ name: row.name, workshopId });
  }
  return options;
}

/** A map's radar calibration triplet (Phase 3). `null` when the map isn't calibrated. */
export interface MapCalibration {
  mapId: number;
  posX: number;
  posY: number;
  scale: number;
  source: string | null;
}

/**
 * Read a map's radar calibration by slug. Returns `null` unless the full triplet AND
 * a radar image are present — callers (the replay player, the heatmap) fall back to
 * auto-fit when uncalibrated, so a partially-filled row is treated as uncalibrated.
 */
export async function getMapCalibration(slug: string): Promise<MapCalibration | null> {
  const { data } = await supabase
    .from('maps')
    .select('id, radar_pos_x, radar_pos_y, radar_scale, radar_image_url, radar_source')
    .eq('slug', slug)
    .maybeSingle();
  const r = data as {
    id: number;
    radar_pos_x: number | null;
    radar_pos_y: number | null;
    radar_scale: number | null;
    radar_image_url: string | null;
    radar_source: string | null;
  } | null;
  if (!r || r.radar_pos_x == null || r.radar_pos_y == null || r.radar_scale == null) return null;
  if (!r.radar_image_url) return null;
  return { mapId: r.id, posX: r.radar_pos_x, posY: r.radar_pos_y, scale: r.radar_scale, source: r.radar_source };
}

/** One heatmap point tagged with its source match (so the map page can season-filter). */
export interface MapHeatmapPoint {
  matchId: number;
  kind: HeatmapKind;
  x: number;
  y: number;
  side: 'CT' | 'T' | null;
}

/**
 * Aggregate the compact `heatmap.json` artifacts (kill/death/grenade points) for a
 * set of matches into a flat, match-tagged list for the map Heatmap tab. Matches
 * without a replay yet are silently skipped (no artifact in R2). Reads are small
 * gzipped files; we fan out with Promise.all and let the page's revalidate cache it.
 */
export async function getMapHeatmap(matchIds: number[]): Promise<MapHeatmapPoint[]> {
  const perMatch = await Promise.all(
    matchIds.map(async (matchId): Promise<MapHeatmapPoint[]> => {
      const buf = await getR2Object(heatmapKey(matchId));
      if (!buf) return [];
      try {
        const json = gunzipMaybe(buf);
        const art = JSON.parse(json.toString('utf8')) as HeatmapArtifact;
        return art.points.map((p) => ({
          matchId,
          kind: p.kind,
          x: p.x,
          y: p.y,
          side: p.side,
        }));
      } catch {
        return [];
      }
    }),
  );
  return perMatch.flat();
}

/**
 * Match ids played on a given map (case-insensitive), for the match-page scouting
 * report's Map Intel heatmap. The played map is the pick (`shirts_pick`) falling back
 * to `picked_map` — the same rule `getMapDetail` uses. Only played matches qualify;
 * matches without a replay artifact are silently dropped later by `getMapHeatmap`.
 */
export async function getMatchIdsForMap(mapName: string): Promise<number[]> {
  const nameLower = mapName.trim().toLowerCase();
  if (!nameLower) return [];
  const { data, error } = await supabase
    .from('matches')
    .select('id, shirts_pick, picked_map, final_score')
    .limit(10000);
  if (error) throw error;
  type Row = { id: number; shirts_pick: string | null; picked_map: string | null; final_score: string | null };
  return ((data ?? []) as Row[])
    .filter(
      (m) =>
        (m.shirts_pick ?? m.picked_map ?? '').trim().toLowerCase() === nameLower &&
        isPlayedScore(m.final_score),
    )
    .map((m) => m.id);
}

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

/** Job statuses that still have a staged `demo-result.json` artifact in R2 to read detail from. */
const DEMO_INGEST_STAGED_STATUSES: ReadonlySet<string> = new Set(['parsed', 'quarantined']);

/** Display context for a match-keyed background job (`buildJobSubject` turns this into a subject). */
interface MatchJobContext {
  label: string;
  seasonNumber: number | null;
  weekNumber: number | null;
  matchNumber: number | null;
  pickedMap: string | null;
  finalScore: string | null;
  isGauntlet: boolean;
}

/**
 * Batch-load display context (match → week → season) for match-keyed background jobs in
 * three queries, not per-row. Shared by the jobs dashboard so demo and replay rows label
 * identically.
 */
async function loadMatchJobContext(matchIds: number[]): Promise<Map<number, MatchJobContext>> {
  const out = new Map<number, MatchJobContext>();
  if (!matchIds.length) return out;

  const { data: matchRows } = await supabase
    .from('matches')
    .select('id, match_number, picked_map, final_score, week_id')
    .in('id', matchIds);
  const matches = (matchRows ?? []) as Pick<
    Match,
    'id' | 'match_number' | 'picked_map' | 'final_score' | 'week_id'
  >[];

  const weekIds = Array.from(new Set(matches.map((m) => m.week_id)));
  const { data: weekRows } = weekIds.length
    ? await supabase.from('weeks').select('id, week_number, season_id').in('id', weekIds)
    : { data: [] as Pick<Week, 'id' | 'week_number' | 'season_id'>[] };
  const weeks = (weekRows ?? []) as Pick<Week, 'id' | 'week_number' | 'season_id'>[];

  const seasonIds = Array.from(new Set(weeks.map((w) => w.season_id)));
  const { data: seasonRows } = seasonIds.length
    ? await supabase.from('seasons').select('id, name, is_gauntlet').in('id', seasonIds)
    : { data: [] as Pick<Season, 'id' | 'name' | 'is_gauntlet'>[] };
  const seasons = (seasonRows ?? []) as Pick<Season, 'id' | 'name' | 'is_gauntlet'>[];

  const weekById = new Map(weeks.map((w) => [w.id, w]));
  const seasonById = new Map(seasons.map((s) => [s.id, s]));

  for (const m of matches) {
    const w = weekById.get(m.week_id) ?? null;
    const s = w ? seasonById.get(w.season_id) ?? null : null;
    out.set(m.id, {
      label: matchLabel({
        matchId: m.id,
        seasonName: s?.name ?? null,
        weekNumber: w?.week_number ?? null,
        matchNumber: m.match_number ?? null,
      }),
      seasonNumber: s?.name ? extractSeasonNumber(s.name) : null,
      weekNumber: w?.week_number ?? null,
      matchNumber: m.match_number ?? null,
      pickedMap: m.picked_map ?? null,
      finalScore: m.final_score ?? null,
      isGauntlet: s?.is_gauntlet ?? false,
    });
  }
  return out;
}

/** Resolve a job row's subject (match vs map) to a labeled, linkable descriptor. */
function buildJobSubject(
  job: { jobType: BackgroundJobType; matchId: number | null; mapId: number | null },
  matchCtx: Map<number, MatchJobContext>,
  mapById: Map<number, { name: string; slug: string }>,
): BackgroundJobSubject {
  if (job.jobType === 'radar_build') {
    const mapId = job.mapId ?? 0;
    const m = mapId ? mapById.get(mapId) : undefined;
    return {
      kind: 'map',
      mapId,
      slug: m?.slug ?? '',
      label: m?.name ?? `Map #${mapId}`,
      href: m?.slug ? `/maps/${m.slug}` : '/maps',
    };
  }
  const matchId = job.matchId ?? 0;
  const ctx = matchId ? matchCtx.get(matchId) : undefined;
  return {
    kind: 'match',
    matchId,
    label: ctx?.label ?? `Match #${matchId}`,
    href: `/matches/${matchId}`,
    seasonNumber: ctx?.seasonNumber ?? null,
    weekNumber: ctx?.weekNumber ?? null,
    matchNumber: ctx?.matchNumber ?? null,
    pickedMap: ctx?.pickedMap ?? null,
    finalScore: ctx?.finalScore ?? null,
    isGauntlet: ctx?.isGauntlet ?? false,
  };
}

/**
 * All background jobs across every pipeline, newest activity first. The admin jobs
 * dashboard (#145) is the single notification channel for anything that would otherwise
 * fail silently. Defensive: returns `[]` if `background_jobs` isn't present yet so the
 * page never hard-fails.
 */
export async function getBackgroundJobs(): Promise<BackgroundJobRow[]> {
  try {
    const { data: jobs, error } = await supabase
      .from('background_jobs')
      .select(
        'job_type, match_id, map_id, status, stage, error_message, gh_run_url, created_at, updated_at, started_at, finished_at',
      )
      .in('job_type', [...BACKGROUND_JOB_TYPES])
      .order('updated_at', { ascending: false });
    if (error || !jobs) return [];

    type JobRow = {
      job_type: BackgroundJobType;
      match_id: number | null;
      map_id: number | null;
      status: string | null;
      stage: string | null;
      error_message: string | null;
      gh_run_url: string | null;
      created_at: string | null;
      updated_at: string | null;
      started_at: string | null;
      finished_at: string | null;
    };
    const jobRows = jobs as JobRow[];

    // Batch subject context: match → week → season for match-keyed jobs, and maps for radar.
    const matchIds = Array.from(
      new Set(jobRows.filter((j) => j.match_id != null).map((j) => j.match_id as number)),
    );
    const mapIds = Array.from(
      new Set(jobRows.filter((j) => j.map_id != null).map((j) => j.map_id as number)),
    );

    const matchCtx = await loadMatchJobContext(matchIds);

    const { data: mapRows } = mapIds.length
      ? await supabase.from('maps').select('id, name, slug').in('id', mapIds)
      : { data: [] as { id: number; name: string; slug: string }[] };
    const mapById = new Map(
      ((mapRows ?? []) as { id: number; name: string; slug: string }[]).map((m) => [m.id, m]),
    );

    // Enrich staged demo-ingest jobs with parse warnings / quarantine flags from R2 (bounded:
    // only `parsed`/`quarantined` rows still have an artifact). Read in parallel.
    const staged = jobRows.filter(
      (j) =>
        j.job_type === DEMO_INGEST_JOB_TYPE &&
        j.match_id != null &&
        DEMO_INGEST_STAGED_STATUSES.has(j.status ?? ''),
    );
    const detailByMatch = new Map<number, { warnings: string[]; quarantineFlags: string[]; hasPayload: boolean }>();
    await Promise.all(
      staged.map(async (j) => {
        const matchId = j.match_id as number;
        try {
          const buf = await getR2Object(demoResultKey(matchId));
          if (!buf) return;
          const r = JSON.parse(gunzipMaybe(buf).toString()) as DemoIngestResult;
          detailByMatch.set(matchId, {
            warnings: r.warnings ?? [],
            quarantineFlags: r.quarantineFlags ?? [],
            hasPayload: r.payload != null,
          });
        } catch {
          /* corrupt/partial artifact — leave detail empty, status still shows */
        }
      }),
    );

    return jobRows.map((j): BackgroundJobRow => {
      const detail = j.match_id != null ? detailByMatch.get(j.match_id) : undefined;
      return {
        jobType: j.job_type,
        status: j.status ?? 'unknown',
        stage: j.stage,
        errorMessage: j.error_message,
        ghRunUrl: j.gh_run_url,
        createdAt: j.created_at,
        updatedAt: j.updated_at,
        startedAt: j.started_at,
        finishedAt: j.finished_at,
        subject: buildJobSubject(
          { jobType: j.job_type, matchId: j.match_id, mapId: j.map_id },
          matchCtx,
          mapById,
        ),
        warnings: detail?.warnings ?? [],
        quarantineFlags: detail?.quarantineFlags ?? [],
        hasPayload: detail?.hasPayload ?? false,
      };
    });
  } catch {
    return [];
  }
}

export interface ReplayEventsRound {
  round: number;
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
      sideByFaction: r.sideByFaction,
      events: r.events,
    })),
  };
}

export interface OpsErrorRow {
  id: number;
  entityType: OpsErrorEntityType;
  entityId: number;
  operation: string;
  message: string;
  occurredAt: string;
  /** Human-readable name for the row's entity — a season/match/player name, or "EHOG Recompute"
   * for the system-wide singleton — resolved here so the admin UI never has to. */
  label: string;
}

/**
 * Every currently-live best-effort-operation failure, newest first — the single admin surface for
 * anything recorded via `recordOpsError()` (`src/lib/ops-errors.ts`). Resolves each row's
 * `entity_id` to a display name with a handful of batched follow-up queries, one per entity type
 * present.
 */
export async function getOpsErrors(): Promise<OpsErrorRow[]> {
  const { data, error } = await supabase
    .from('ops_errors')
    .select('id, entity_type, entity_id, operation, message, occurred_at')
    .order('occurred_at', { ascending: false });
  if (error) throw error;
  type Row = {
    id: number;
    entity_type: OpsErrorEntityType;
    entity_id: number;
    operation: string;
    message: string;
    occurred_at: string;
  };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const seasonIds = rows.filter((r) => r.entity_type === 'season').map((r) => r.entity_id);
  const matchIds = rows.filter((r) => r.entity_type === 'match').map((r) => r.entity_id);

  const [seasonRes, matchRes] = await Promise.all([
    seasonIds.length
      ? supabase.from('seasons').select('id, name').in('id', seasonIds)
      : Promise.resolve({ data: [] }),
    matchIds.length
      ? supabase.from('matches').select('id, match_number, weeks(week_number, seasons(name))').in('id', matchIds)
      : Promise.resolve({ data: [] }),
  ]);

  const seasonName = new Map(((seasonRes.data ?? []) as { id: number; name: string }[]).map((s) => [s.id, s.name]));
  type MatchJoinRow = {
    id: number;
    match_number: number | null;
    weeks: { week_number: number | null; seasons: { name: string | null } | null } | null;
  };
  const matchLbl = new Map(
    ((matchRes.data ?? []) as unknown as MatchJoinRow[]).map((m) => [
      m.id,
      matchLabel({
        matchId: m.id,
        seasonName: m.weeks?.seasons?.name,
        weekNumber: m.weeks?.week_number,
        matchNumber: m.match_number,
      }),
    ]),
  );

  const labelFor = (r: Row): string => {
    switch (r.entity_type) {
      case 'season':
        return seasonName.get(r.entity_id) ?? `Season #${r.entity_id}`;
      case 'match':
        return matchLbl.get(r.entity_id) ?? `Match #${r.entity_id}`;
      case 'system':
        return 'EHOG Recompute';
    }
  };

  return rows.map((r) => ({
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    operation: r.operation,
    message: r.message,
    occurredAt: r.occurred_at,
    label: labelFor(r),
  }));
}
