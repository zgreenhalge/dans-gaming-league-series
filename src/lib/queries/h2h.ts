import { unstable_cache } from 'next/cache';
import { getAdminClient } from '../supabase-admin';
import {
  extractSeasonNumber,
  buildRegularToGauntletMap,
  isPlayedScore,
  winRatePct,
} from '../util';
import { computeH2H, rivalEvenness, resolveH2HPickedBy, type DuoStats, type H2HStats, type H2HData, type H2HMatchInput } from '../h2h';
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

// ─── Friends and Rival ratings ───────────────────────────────────────────────
//
// Each rating is a sum of weighted terms (points out of 100) divided by the league's best pair's
// sum, so the best pair reads 100. See "Narrative Metrics" in docs/calculations.md for the formulas
// and the reasoning behind each term. The term functions below are the single source of the maths:
// the scorers rank with them and the breakdown scorers print them.

/** Pairs this far from the league's most-played pair are shrunk toward zero: a term's confidence in
 *  a pair is `g / (g + RATING_K)`, so one lucky game can't outrank a long history. */
const RATING_K = 16;

/** Friends Rating weights, in points out of 100. */
const FRIENDS_WEIGHTS = { games: 25, winRate: 15, rwr: 15, odds: 30, lift: 15 };
/** The Friends Rating's terms and weights in one line, for the rating tooltips and card headers. */
export const FRIENDS_RATING_SUMMARY =
  `${FRIENDS_WEIGHTS.games}% games together · ${FRIENDS_WEIGHTS.winRate}% win rate · ${FRIENDS_WEIGHTS.rwr}% round win rate · `
  + `${FRIENDS_WEIGHTS.odds}% wins above the pre-match odds · ${FRIENDS_WEIGHTS.lift}% ADR above their usual · scaled so the best duo is 100`;
/** A duo's odds term is full at this many wins above expectation per game (after shrinking). */
const ODDS_FULL = 0.15;
/** A duo's lift term is full at this ADR gain over its players' ADR elsewhere (after shrinking). */
const LIFT_FULL = 0.1;

/** Rival Rating weights, in points out of 100. */
const RIVAL_WEIGHTS = { meetings: 30, winCloseness: 20, roundCloseness: 20, upsets: 30 };
/** The Rival Rating's terms and weights in one line, for the rating tooltips and card headers. */
export const RIVAL_RATING_SUMMARY =
  `${RIVAL_WEIGHTS.meetings}% meetings · ${RIVAL_WEIGHTS.winCloseness}% closeness of the win record · ${RIVAL_WEIGHTS.roundCloseness}% closeness of rounds · `
  + `${RIVAL_WEIGHTS.upsets}% upsets by both sides · scaled by how even the record is² · best rivalry is 100`;
/** A rivalry's upset term is full at this much mutual upset score per meeting (after shrinking). */
const UPSET_FULL = 0.05;

const confidence = (games: number) => games / (games + RATING_K);
/** `value / max`, 0 when there is no max to compare to. */
const fractionOf = (value: number, max: number) => (max > 0 ? value / max : 0);
/** `value` as a 0–1 fraction of `full`, never below 0. */
const capped = (value: number, full: number) => Math.min(1, Math.max(0, value) / full);
const sumOf = (terms: Record<string, number>) => Object.values(terms).reduce((total, v) => total + v, 0);

export interface FriendsTerms { games: number; winRate: number; rwr: number; odds: number; lift: number }

/**
 * Returns each Friends Rating term as weighted points for a duo, normalised against the league's
 * `duos`. Computes the league maxes once, then returns a closure.
 */
function duoTermsScorer(duos: DuoStats[]): (d: DuoStats) => FriendsTerms {
  const eligible = duos.filter((d) => d.gamesPlayed > 0);
  const maxGames = Math.max(1, ...eligible.map((d) => d.gamesPlayed));
  const maxWinRate = Math.max(0, ...eligible.map((d) => d.wins / d.gamesPlayed));
  const maxRwr = Math.max(0, ...eligible.map((d) => winRatePct(d.roundsWon, d.roundsPlayed)));
  const w = FRIENDS_WEIGHTS;
  return (d) => {
    if (d.gamesPlayed === 0) return { games: 0, winRate: 0, rwr: 0, odds: 0, lift: 0 };
    const g = d.gamesPlayed;
    // Win rate and round win rate are scaled by how settled the pair's sample is relative to the
    // most-played duo, so only the games term lifts a pair with a thin history.
    const settled = confidence(g) / confidence(maxGames);
    return {
      games: w.games * (g / maxGames),
      winRate: w.winRate * settled * fractionOf(d.wins / g, maxWinRate),
      rwr: w.rwr * settled * fractionOf(winRatePct(d.roundsWon, d.roundsPlayed), maxRwr),
      odds: w.odds * capped(d.winsAboveExpected / (g + RATING_K), ODDS_FULL),
      lift: w.lift * capped(d.adrLift * confidence(g), LIFT_FULL),
    };
  };
}

export interface RivalTerms { meetings: number; winCloseness: number; roundCloseness: number; upsets: number; evenness: number }

/**
 * Returns each Rival Rating term as weighted points for a rivalry, normalised against the league's
 * `rivals`, plus its `evenness` (1 for an even record, toward 0 as it turns lopsided). Computes the
 * league maxes once, then returns a closure.
 */
function rivalTermsScorer(rivals: H2HStats[]): (r: H2HStats) => RivalTerms {
  const eligible = rivals.filter((r) => r.meetings > 0);
  const maxMeetings = Math.max(1, ...eligible.map((r) => r.meetings));
  const maxWinDiff = Math.max(1, ...eligible.map((r) => Math.abs(r.aWins - r.bWins)));
  const maxRoundDiff = Math.max(1, ...eligible.map((r) => Math.abs(r.aStats.roundsWon - r.bStats.roundsWon) / r.meetings));
  const w = RIVAL_WEIGHTS;
  return (r) => {
    if (r.meetings === 0) return { meetings: 0, winCloseness: 0, roundCloseness: 0, upsets: 0, evenness: 0 };
    const m = r.meetings;
    const winDiff = Math.abs(r.aWins - r.bWins);
    const roundDiff = Math.abs(r.aStats.roundsWon - r.bStats.roundsWon) / m;
    const settled = confidence(m) / confidence(maxMeetings);
    // An upset only counts as a rivalry when both sides land them: the weaker side sets the score.
    const mutualUpsets = 2 * Math.min(r.aUpsetScore, r.bUpsetScore);
    return {
      meetings: w.meetings * (m / maxMeetings),
      winCloseness: w.winCloseness * settled * (1 - winDiff / maxWinDiff),
      roundCloseness: w.roundCloseness * settled * (1 - roundDiff / maxRoundDiff),
      upsets: w.upsets * capped(mutualUpsets / (m + RATING_K), UPSET_FULL),
      evenness: rivalEvenness(r),
    };
  };
}

/** A rivalry's points before rescaling: its terms, scaled by the square of how even its record is. */
const rivalPoints = (t: RivalTerms) => (t.meetings + t.winCloseness + t.roundCloseness + t.upsets) * t.evenness ** 2;

/** A pair's points divided by the best pair's, or 0 when no pair has any points. */
function relativeToBest<T>(items: T[], points: (item: T) => number): (item: T) => number {
  const best = Math.max(0, ...items.map(points));
  return (item) => (best > 0 ? points(item) / best : 0);
}

/**
 * Returns a scorer for the "Best Friends" blended metric — see "Blended score" in docs/glossary.md.
 * The score is 0–1: a duo's weighted terms (`duoTermsScorer()`) over the best duo's. Shared by
 * `H2HSection` (ranking) and `H2HMatrix` (cell coloring) so both use the same formula.
 * IMPORTANT: if you change weights here, update `duoBreakdownScorer()` and docs/calculations.md.
 */
export function duoBlendedScorer(duos: DuoStats[]): (d: DuoStats) => number {
  const terms = duoTermsScorer(duos);
  const points = (d: DuoStats) => sumOf({ ...terms(d) });
  return relativeToBest(duos.filter((d) => d.gamesPlayed > 0), points);
}

/**
 * Returns a scorer for the "Closest Rivals" blended metric — see "Blended score" in docs/glossary.md.
 * The score is 0–1: a rivalry's weighted terms (`rivalTermsScorer()`) scaled by its evenness, over
 * the best rivalry's. Shared by `H2HSection` (ranking) and `H2HMatrix` (cell coloring).
 * IMPORTANT: if you change weights here, update `rivalBreakdownScorer()` and docs/calculations.md.
 */
export function rivalBlendedScorer(rivals: H2HStats[]): (r: H2HStats) => number {
  const terms = rivalTermsScorer(rivals);
  return relativeToBest(rivals.filter((r) => r.meetings > 0), (r) => rivalPoints(terms(r)));
}

/** Returns a closure that formats the per-term breakdown of the friend score as a tooltip string:
 *  each term's points out of its weight, and the total against the best duo's. */
export function duoBreakdownScorer(duos: DuoStats[]): (d: DuoStats) => string {
  const terms = duoTermsScorer(duos);
  const points = (d: DuoStats) => sumOf({ ...terms(d) });
  const best = Math.max(0, ...duos.filter((d) => d.gamesPlayed > 0).map(points));
  const w = FRIENDS_WEIGHTS;
  return (d) => {
    const t = terms(d);
    return `Games ${Math.round(t.games)}/${w.games} · Win rate ${Math.round(t.winRate)}/${w.winRate} · Rounds ${Math.round(t.rwr)}/${w.rwr}`
      + ` · Odds ${Math.round(t.odds)}/${w.odds} · ADR lift ${Math.round(t.lift)}/${w.lift} · Total ${Math.round(points(d))} of best ${Math.round(best)}`;
  };
}

/** Returns a closure that formats the per-term breakdown of the rival score as a tooltip string:
 *  each term's points out of its weight, the evenness scaling, and the total against the best
 *  rivalry's. */
export function rivalBreakdownScorer(rivals: H2HStats[]): (r: H2HStats) => string {
  const terms = rivalTermsScorer(rivals);
  const best = Math.max(0, ...rivals.filter((r) => r.meetings > 0).map((r) => rivalPoints(terms(r))));
  const w = RIVAL_WEIGHTS;
  return (r) => {
    const t = terms(r);
    return `Meetings ${Math.round(t.meetings)}/${w.meetings} · Closeness ${Math.round(t.winCloseness)}/${w.winCloseness} · Rounds ${Math.round(t.roundCloseness)}/${w.roundCloseness}`
      + ` · Upsets ${Math.round(t.upsets)}/${w.upsets} · Evenness ×${(t.evenness ** 2).toFixed(2)} · Total ${Math.round(rivalPoints(t))} of best ${Math.round(best)}`;
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

/** The `limit` highest-scoring `items`, best first, each built into a `R` with its score as a
 *  rounded 0–100 rating. */
function rankBy<T, R>(items: T[], score: (item: T) => number, limit: number, make: (item: T, rating: number) => R): R[] {
  return items
    .map((item) => ({ item, raw: score(item) }))
    .sort((x, y) => y.raw - x.raw)
    .slice(0, limit)
    .map(({ item, raw }) => make(item, Math.round(raw * 100)));
}

/**
 * The `limit` highest-rated duos (the "Best Friends" ranking) — only pairs that have played together,
 * normalised against the full `duos` set so the rating matches the one shown beside any other
 * ranking of the same data. Shared by `H2HSection` and the home page's Top duos panel.
 */
export function rankDuos(duos: DuoStats[], limit: number): RankedDuo[] {
  return rankBy(duos.filter((d) => d.gamesPlayed > 0), duoBlendedScorer(duos), limit, (duo, rating) => ({ duo, rating }));
}

/** The rivalry counterpart of `rankDuos()` — the "Closest Rivals" ranking. */
export function rankRivals(rivals: H2HStats[], limit: number): RankedRival[] {
  return rankBy(rivals.filter((r) => r.meetings > 0), rivalBlendedScorer(rivals), limit, (rival, rating) => ({ rival, rating }));
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
    .select('id, week_id, match_number, final_score, pre_match_win_prob, shirts_pick, skins_pick, skins_starting_side')
    .in('week_id', [...weekLookup.keys()]);
  if (mErr) throw mErr;

  type MatchRow = {
    id: number;
    week_id: number;
    match_number: number;
    final_score: string | null;
    pre_match_win_prob: number | null;
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
      shirtsWinProb: m.pre_match_win_prob,
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
