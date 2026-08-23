import { unstable_cache } from 'next/cache';
import { supabase } from '../supabase';
import {
  extractSeasonNumber,
  buildRegularToGauntletMap,
  isPlayedScore,
  winRatePct,
} from '../util';
import { computeH2H, resolveH2HPickedBy, type DuoStats, type H2HStats, type H2HData, type H2HMatchInput } from '../h2h';
import { mapSlug } from '../maps';
import type { Season, Faction } from '../types';
import { getSeasons } from './seasons';
import { getPlayersById } from './player';
import { getWeekLookup } from './_shared';


// ─── H2H data layer ──────────────────────────────────────────────────────────
//
// Powers the H2H tab on the Statistics page, the Map detail page, and the
// match scouting report. The aggregation core (`computeH2H`) lives in
// `../h2h.ts` — client-bundle-safe (no supabase import) — so the Statistics and
// Map pages, which already load full match history client-side for their
// other tabs, can compute H2H directly from it and honor a live season filter
// instead of a static server-fetched snapshot. `getH2HData` below is the
// DB-backed entry point for pages that don't already hold that data (player
// page, season page, match scouting) — see `docs/patterns.md` re: extracting
// shared aggregation logic instead of duplicating it.
//
// Types re-exported here so every existing `import { H2HData } from '@/lib/queries'` keeps resolving.
export type {
  MatchRosterPlayer,
  DuoMatchSummary,
  RivalMatchSummary,
  DuoStats,
  H2HPlayerStats,
  H2HStats,
  H2HMapStat,
  H2HData,
} from '../h2h';

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

/** League-wide normalisation anchors for the "Best Friends" formula — see `computeDuoMaxes()`. */
export interface DuoScoreMaxes {
  maxGames: number;
  maxWinRate: number;
  maxRwr: number;
}

/** League-wide normalisation anchors for the "Closest Rivals" formula — see `computeRivalMaxes()`. */
export interface RivalScoreMaxes {
  maxMeetings: number;
  maxWinDiff: number;
  maxRoundDiff: number;
}

/** Computes the "Best Friends" normalisation anchors once across every eligible duo in the league. */
export function computeDuoMaxes(duos: DuoStats[]): DuoScoreMaxes {
  const eligible = duos.filter((d) => d.gamesPlayed > 0);
  return {
    maxGames: Math.max(1, ...eligible.map((d) => d.gamesPlayed)),
    maxWinRate: Math.max(1, ...eligible.map((d) => d.wins / d.gamesPlayed)),
    maxRwr: Math.max(1, ...eligible.map((d) => winRatePct(d.roundsWon, d.roundsPlayed))),
  };
}

/** Computes the "Closest Rivals" normalisation anchors once across every eligible rivalry in the league. */
export function computeRivalMaxes(rivals: H2HStats[]): RivalScoreMaxes {
  const eligible = rivals.filter((r) => r.meetings > 0);
  return {
    maxMeetings: Math.max(1, ...eligible.map((r) => r.meetings)),
    maxWinDiff: Math.max(1, ...eligible.map((r) => Math.abs(r.aWins - r.bWins))),
    maxRoundDiff: Math.max(1, ...eligible.map((r) => Math.abs(r.aStats.roundsWon - r.bStats.roundsWon) / r.meetings)),
  };
}

/**
 * The "Best Friends" formula (see "Friends Rating" in docs/calculations.md) applied to a duo's raw
 * inputs against already-computed league maxes — the primitive form `duoBlendedScorer`,
 * `duoBreakdownScorer`, and the For Nerds calculator (`FriendsRivalCalculator.tsx`) all share.
 * IMPORTANT: if you change these weights, update the hover `title` in H2HSection.tsx ("Best Friends")
 * and docs/calculations.md.
 */
export function friendsScore(gamesPlayed: number, wins: number, roundsWon: number, roundsPlayed: number, maxes: DuoScoreMaxes): number {
  if (gamesPlayed <= 0) return 0;
  return (
    0.5 * (gamesPlayed / maxes.maxGames) ** 2 +
    0.3 * ((wins / gamesPlayed) / maxes.maxWinRate) ** 2 +
    0.2 * (winRatePct(roundsWon, roundsPlayed) / maxes.maxRwr) ** 2
  );
}

/**
 * The "Closest Rivals" formula (see "Rival Rating" in docs/calculations.md) applied to a rivalry's
 * raw inputs against already-computed league maxes — the primitive form `rivalBlendedScorer`,
 * `rivalBreakdownScorer`, and the For Nerds calculator (`FriendsRivalCalculator.tsx`) all share.
 * IMPORTANT: if you change these weights, update the hover `title` in H2HSection.tsx ("Closest
 * Rivals" and "Best Friends") and docs/calculations.md.
 */
export function rivalScore(meetings: number, aWins: number, bWins: number, aRoundsWon: number, bRoundsWon: number, maxes: RivalScoreMaxes): number {
  if (meetings <= 0) return 0;
  return (
    0.5 * (meetings / maxes.maxMeetings) ** 2 +
    0.3 * (1 - Math.abs(aWins - bWins) / maxes.maxWinDiff) ** 2 +
    0.2 * (1 - (Math.abs(aRoundsWon - bRoundsWon) / meetings) / maxes.maxRoundDiff) ** 2
  );
}

/**
 * Returns a scorer for the "Best Friends" blended metric — see "Blended score" in docs/glossary.md.
 * Computes normalisation maxes once across `duos` then returns a closure. Shared by
 * `H2HSection` (ranking) and `H2HMatrix` (cell coloring) so both use the same formula.
 */
export function duoBlendedScorer(duos: DuoStats[]): (d: DuoStats) => number {
  const maxes = computeDuoMaxes(duos);
  return (d) => friendsScore(d.gamesPlayed, d.wins, d.roundsWon, d.roundsPlayed, maxes);
}

/**
 * Returns a scorer for the "Closest Rivals" blended metric — see "Blended score" in docs/glossary.md.
 * Computes normalisation maxes once across `rivals` then returns a closure. Shared by
 * `H2HSection` (ranking) and `H2HMatrix` (cell coloring) so both use the same formula.
 */
export function rivalBlendedScorer(rivals: H2HStats[]): (r: H2HStats) => number {
  const maxes = computeRivalMaxes(rivals);
  return (r) => rivalScore(r.meetings, r.aWins, r.bWins, r.aStats.roundsWon, r.bStats.roundsWon, maxes);
}

/** Returns a closure that formats the per-component breakdown of the friend score as a tooltip string. */
export function duoBreakdownScorer(duos: DuoStats[]): (d: DuoStats) => string {
  const maxes = computeDuoMaxes(duos);
  return (d) => {
    const games   = Math.round(0.5 * (d.gamesPlayed / maxes.maxGames) ** 2 * 100);
    const winRate = Math.round(0.3 * ((d.wins / d.gamesPlayed) / maxes.maxWinRate) ** 2 * 100);
    const rwr     = Math.round(0.2 * (winRatePct(d.roundsWon, d.roundsPlayed) / maxes.maxRwr) ** 2 * 100);
    return `Games ${games}/50 · Win rate ${winRate}/30 · Rounds ${rwr}/20`;
  };
}

/** Returns a closure that formats the per-component breakdown of the rival score as a tooltip string. */
export function rivalBreakdownScorer(rivals: H2HStats[]): (r: H2HStats) => string {
  const maxes = computeRivalMaxes(rivals);
  return (r) => {
    const meetings  = Math.round(0.5 * (r.meetings / maxes.maxMeetings) ** 2 * 100);
    const closeness = Math.round(0.3 * (1 - Math.abs(r.aWins - r.bWins) / maxes.maxWinDiff) ** 2 * 100);
    const rounds    = Math.round(0.2 * (1 - (Math.abs(r.aStats.roundsWon - r.bStats.roundsWon) / r.meetings) / maxes.maxRoundDiff) ** 2 * 100);
    return `Meetings ${meetings}/50 · Closeness ${closeness}/30 · Rounds ${rounds}/20`;
  };
}


/**
 * Computes head-to-head relationship data — partner records (`duos`) and
 * opponent records (`rivals`) — for the given resolved season selection.
 * Only played matches count (see `isPlayedScore`). Fetches the raw match/stat
 * rows and delegates the actual aggregation to `computeH2H` (`../h2h.ts`).
 */
export async function getH2HData(selection: H2HSeasonSelection): Promise<H2HData> {
  const seasons = await getSeasons();
  const regularSeasons = seasons.filter((s) => !s.is_gauntlet);
  const gauntletSeasons = seasons.filter((s) => s.is_gauntlet);
  const regularToGauntlet = buildRegularToGauntletMap(regularSeasons, gauntletSeasons);
  const seasonIds = resolveH2HSeasonIds(selection, regularSeasons, gauntletSeasons, regularToGauntlet);
  if (seasonIds.size === 0) return { duos: [], rivals: [], players: [] };

  const [weekLookup, players] = await Promise.all([
    getWeekLookup([...seasonIds]),
    getPlayersById(),
  ]);
  if (weekLookup.size === 0) return { duos: [], rivals: [], players: [] };
  const allSeasons = [...regularSeasons, ...gauntletSeasons];
  const seasonNumberById = new Map(allSeasons.map((s) => [s.id, extractSeasonNumber(s.name)]));
  const seasonIsGauntletById = new Map(allSeasons.map((s) => [s.id, s.is_gauntlet]));

  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, week_id, match_number, final_score, shirts_pick, picked_map, skins_starting_side')
    .in('week_id', [...weekLookup.keys()]);
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
    const week = weekLookup.get(m.week_id);
    const seasonId = week?.season_id ?? -1;
    matchInputs.push({
      matchId: m.id,
      weekNumber: week?.week_number ?? 0,
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

/**
 * `getH2HData({filter: 'career', includeRegular: true, includeGauntlet: true})`, cached and shared
 * across every request for 60s — matching the match page's own `revalidate = 60` staleness budget.
 * Every match page's scouting report calls this identical selection (its Friendship/Rivalry ratings
 * need the true league-wide `duos`/`rivals` to normalize against, not a per-match subset — see
 * `duoBlendedScorer`/`rivalBlendedScorer` below), so this is one canonical computation shared across
 * every match page load instead of a fresh full-league scan on each one.
 */
export const getCareerH2HDataCached = unstable_cache(
  () => getH2HData({ filter: 'career', includeRegular: true, includeGauntlet: true }),
  ['h2h-career'],
  { revalidate: 60 },
);
