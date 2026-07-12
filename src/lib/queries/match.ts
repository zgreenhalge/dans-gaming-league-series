import { supabase } from '../supabase';
import type { Match, Week, Season, PlayerMatchStat, PlayerMatchSabremetrics, Faction } from '../types';
import { isPlayedScore, avgOf, compareMatchRefDesc, extractSeasonNumber, matchLabel } from '../util';
import { mapSlug } from '../maps';
import type { ScheduledMatchRef } from '../schedule';
import { getPlayersById } from './player';
import { fetchAllPages } from './_shared';


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

  type LeagueMatchRow = { id: number; final_score: string | null; shirts_pick: string | null; picked_map: string | null };
  type LeagueStatRow = { match_id: number; adr: number; kills: number; deaths: number; assists: number; is_win: boolean };

  const [statRows, players, leagueStatRows, leagueMatchRows] = await Promise.all([
    fetchAllPages<PlayerMatchStat>((from, to) =>
      supabase.from('player_match_stats').select('*').in('player_id', playerIds).range(from, to),
    ),
    getPlayersById(),
    fetchAllPages<LeagueStatRow>((from, to) =>
      supabase.from('player_match_stats').select('match_id, adr, kills, deaths, assists, is_win').gt('rounds_played', 0).range(from, to),
    ),
    fetchAllPages<LeagueMatchRow>((from, to) =>
      supabase.from('matches').select('id, final_score, shirts_pick, picked_map').range(from, to),
    ),
  ]);
  const allStats = statRows;

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

  const leagueMatchById = new Map<number, LeagueMatchRow>();
  for (const mm of leagueMatchRows) leagueMatchById.set(mm.id, mm);

  // Use a Set of match IDs to count unique matches (not player-stat rows).
  // Each Wingman match has 2 player rows per side, so row-counting would inflate counts by 2×.
  const leagueMapGroups = new Map<string, { adr: number[]; kills: number[]; deaths: number[]; assists: number[]; matches: Set<number> }>();
  for (const s of leagueStatRows) {
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
