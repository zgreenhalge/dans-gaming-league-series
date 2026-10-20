import { unstable_cache } from 'next/cache';
import { getAdminClient } from '../supabase-admin';
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
import { effectivePickedMap } from '../veto';


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

/** A duo with its 0–100 friendship rating (`duoBlendedScorer()` ×100, the number `H2HSection`'s
 *  rating circle shows). */
export interface RankedDuo {
  duo: DuoStats;
  rating: number;
}

/** A rivalry with its 0–100 rivalry rating (`rivalBlendedScorer()` ×100). */
export interface RankedRival {
  rival: H2HStats;
  rating: number;
}

/** The `limit` highest-scoring `items`, best first, each with its score as a rounded 0–100 rating. */
function rankBy<T>(items: T[], score: (item: T) => number, limit: number): { item: T; rating: number }[] {
  return items
    .map((item) => ({ item, raw: score(item) }))
    .sort((x, y) => y.raw - x.raw)
    .slice(0, limit)
    .map(({ item, raw }) => ({ item, rating: Math.round(raw * 100) }));
}

/**
 * The `limit` highest-rated duos (the "Best Friends" ranking) — only pairs that have played together,
 * normalised against the full `duos` set so the rating matches the one shown beside any other
 * ranking of the same data. Shared by `H2HSection` and the home page's Top duos panel.
 */
export function rankDuos(duos: DuoStats[], limit: number): RankedDuo[] {
  return rankBy(duos.filter((d) => d.gamesPlayed > 0), duoBlendedScorer(duos), limit).map(({ item, rating }) => ({ duo: item, rating }));
}

/** The rivalry counterpart of `rankDuos()` — the "Closest Rivals" ranking. */
export function rankRivals(rivals: H2HStats[], limit: number): RankedRival[] {
  return rankBy(rivals.filter((r) => r.meetings > 0), rivalBlendedScorer(rivals), limit).map(({ item, rating }) => ({ rival: item, rating }));
}

/** One player's standing against a single other player, from that player's side. */
export interface PersonalMatchup {
  otherId: number;
  wins: number;
  losses: number;
}

/**
 * The partner `playerId` has the highest friendship rating with (`duoBlendedScorer()`, normalised
 * against the full `duos` set), with their record together. `null` when the player has no
 * partnered games. Ties break on more games together, then the lower partner id.
 */
export function bestFriendOf(duos: DuoStats[], playerId: number): PersonalMatchup | null {
  const score = duoBlendedScorer(duos);
  const [best] = duos
    .filter((d) => d.gamesPlayed > 0 && (d.playerA === playerId || d.playerB === playerId))
    .map((d) => ({ otherId: d.playerA === playerId ? d.playerB : d.playerA, wins: d.wins, losses: d.losses, games: d.gamesPlayed, score: score(d) }))
    .sort((x, y) => y.score - x.score || y.games - x.games || x.otherId - y.otherId);
  return best ? { otherId: best.otherId, wins: best.wins, losses: best.losses } : null;
}

/**
 * The opponent `playerId` has the worst record against — the largest losses-minus-wins margin, so
 * only an opponent who has actually beaten the player more often than not qualifies (`null`
 * otherwise). Ties break on more meetings, then the lower opponent id.
 */
export function worstNightmareOf(rivals: H2HStats[], playerId: number): PersonalMatchup | null {
  const [worst] = rivals
    .filter((r) => r.meetings > 0 && (r.playerA === playerId || r.playerB === playerId))
    .map((r) => {
      const asA = r.playerA === playerId;
      const wins = asA ? r.aWins : r.bWins;
      const losses = asA ? r.bWins : r.aWins;
      return { otherId: asA ? r.playerB : r.playerA, wins, losses, margin: losses - wins };
    })
    .filter((m) => m.margin > 0)
    .sort((x, y) => y.margin - x.margin || y.wins + y.losses - (x.wins + x.losses) || x.otherId - y.otherId);
  return worst ? { otherId: worst.otherId, wins: worst.wins, losses: worst.losses } : null;
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

  const { data: matches, error: mErr } = await getAdminClient()
    .from('matches')
    .select('id, week_id, match_number, final_score, shirts_pick, skins_pick, skins_starting_side')
    .in('week_id', [...weekLookup.keys()]);
  if (mErr) throw mErr;

  type MatchRow = {
    id: number;
    week_id: number;
    match_number: number;
    final_score: string | null;
    shirts_pick: string | null;
    skins_pick: string | null;
    skins_starting_side: 'CT' | 'T' | null;
  };
  const playedMatches = ((matches ?? []) as MatchRow[]).filter((m) => isPlayedScore(m.final_score));
  if (playedMatches.length === 0) return { duos: [], rivals: [], players: [] };

  const mapFilter = selection.map ? mapSlug(selection.map) : null;
  const filteredMatches = mapFilter
    ? playedMatches.filter((m) => mapSlug(effectivePickedMap(m) ?? '') === mapFilter)
    : playedMatches;

  const { data: stats, error: sErr } = await getAdminClient()
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
      map: effectivePickedMap(m),
      pickedBy: resolveH2HPickedBy(m.shirts_pick, m.skins_pick),
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
