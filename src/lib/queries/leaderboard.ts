import { supabase } from '../supabase';
import type { LeaderboardRow, LeaderboardRowWithId, Player } from '../types';
import { canonicalSort, isPlayedScore } from '../util';
import { getPlayersById } from './player';


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
