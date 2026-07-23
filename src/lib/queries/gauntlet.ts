import { supabase } from '../supabase';
import type { LeaderboardRowWithId, PlayerMatchStat, Match } from '../types';
import { allMatchesPlayed, canonicalSort, isPlayedScore } from '../util';
import { getPlayersById } from './player';


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
      const allPlayed = allMatchesPlayed(finalMatches);
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
