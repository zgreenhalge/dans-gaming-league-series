import { rivalEvenness, type DuoStats, type H2HStats } from './h2h';
import { winRatePct } from './util';

// ─── Friends and Rival ratings ───────────────────────────────────────────────
//
// Each rating is a sum of weighted terms (points out of 100) divided by the league's best pair's
// sum, so the best pair reads 100. See "Narrative Metrics" in docs/calculations.md for the formulas
// and the reasoning behind each term. The term functions below are the single source of the maths:
// the scorers rank with them and the breakdown scorers print them. Pure and client-safe, so the
// H2H views can import it directly; `queries/h2h.ts` re-exports it. The rankings built on the
// scorers (`rankDuos()`, `bestFriendOf()`, …) are here too, for the same reason.

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

const playedDuos = (duos: DuoStats[]) => duos.filter((d) => d.gamesPlayed > 0);
const playedRivals = (rivals: H2HStats[]) => rivals.filter((r) => r.meetings > 0);

/** The highest `points` of any item, or 0 for none. */
const bestOf = <T>(items: T[], points: (item: T) => number) => Math.max(0, ...items.map(points));

/** A pair's points divided by the best pair's, or 0 when no pair has any points. */
function relativeToBest<T>(items: T[], points: (item: T) => number): (item: T) => number {
  const best = bestOf(items, points);
  return (item) => (best > 0 ? points(item) / best : 0);
}

export interface FriendsTerms { games: number; winRate: number; rwr: number; odds: number; lift: number }

const duoPoints = (t: FriendsTerms) => t.games + t.winRate + t.rwr + t.odds + t.lift;

/**
 * Returns each Friends Rating term as weighted points for a duo, normalised against the league's
 * `duos`. Computes the league maxes once, then returns a closure.
 */
function duoTermsScorer(duos: DuoStats[]): (d: DuoStats) => FriendsTerms {
  const eligible = playedDuos(duos);
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

export interface RivalTerms { meetings: number; winCloseness: number; roundCloseness: number; upsets: number }

/** A rivalry's points before rescaling: its terms, scaled by the square of how even its record is. */
const rivalPoints = (t: RivalTerms, r: H2HStats) => (t.meetings + t.winCloseness + t.roundCloseness + t.upsets) * rivalEvenness(r) ** 2;

/**
 * Returns each Rival Rating term as weighted points for a rivalry, normalised against the league's
 * `rivals`. Computes the league maxes once, then returns a closure.
 */
function rivalTermsScorer(rivals: H2HStats[]): (r: H2HStats) => RivalTerms {
  const eligible = playedRivals(rivals);
  const maxMeetings = Math.max(1, ...eligible.map((r) => r.meetings));
  const maxWinDiff = Math.max(1, ...eligible.map((r) => Math.abs(r.aWins - r.bWins)));
  const maxRoundDiff = Math.max(1, ...eligible.map((r) => Math.abs(r.aStats.roundsWon - r.bStats.roundsWon) / r.meetings));
  const w = RIVAL_WEIGHTS;
  return (r) => {
    if (r.meetings === 0) return { meetings: 0, winCloseness: 0, roundCloseness: 0, upsets: 0 };
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
    };
  };
}

/**
 * Returns a scorer for the "Best Friends" blended metric — see "Blended score" in docs/glossary.md.
 * The score is 0–1: a duo's weighted terms (`duoTermsScorer()`) over the best duo's. Shared by
 * `H2HSection` (ranking) and `H2HMatrix` (cell coloring) so both use the same formula.
 * Weights live in `FRIENDS_WEIGHTS`; docs/calculations.md lists them too.
 */
export function duoBlendedScorer(duos: DuoStats[]): (d: DuoStats) => number {
  const terms = duoTermsScorer(duos);
  return relativeToBest(playedDuos(duos), (d) => duoPoints(terms(d)));
}

/**
 * Returns a scorer for the "Closest Rivals" blended metric — see "Blended score" in docs/glossary.md.
 * The score is 0–1: a rivalry's weighted terms (`rivalTermsScorer()`) scaled by its evenness, over
 * the best rivalry's. Shared by `H2HSection` (ranking) and `H2HMatrix` (cell coloring).
 * Weights live in `RIVAL_WEIGHTS`; docs/calculations.md lists them too.
 */
export function rivalBlendedScorer(rivals: H2HStats[]): (r: H2HStats) => number {
  const terms = rivalTermsScorer(rivals);
  return relativeToBest(playedRivals(rivals), (r) => rivalPoints(terms(r), r));
}

/** Returns a closure that formats the per-term breakdown of the friend score as a tooltip string:
 *  each term's points out of its weight, and the total against the best duo's. */
export function duoBreakdownScorer(duos: DuoStats[]): (d: DuoStats) => string {
  const terms = duoTermsScorer(duos);
  const best = bestOf(playedDuos(duos), (d) => duoPoints(terms(d)));
  const w = FRIENDS_WEIGHTS;
  return (d) => {
    const t = terms(d);
    return `Games ${Math.round(t.games)}/${w.games} · Win rate ${Math.round(t.winRate)}/${w.winRate} · Rounds ${Math.round(t.rwr)}/${w.rwr}`
      + ` · Odds ${Math.round(t.odds)}/${w.odds} · ADR lift ${Math.round(t.lift)}/${w.lift} · Total ${Math.round(duoPoints(t))} of best ${Math.round(best)}`;
  };
}

/** Returns a closure that formats the per-term breakdown of the rival score as a tooltip string:
 *  each term's points out of its weight, the evenness scaling, and the total against the best
 *  rivalry's. */
export function rivalBreakdownScorer(rivals: H2HStats[]): (r: H2HStats) => string {
  const terms = rivalTermsScorer(rivals);
  const best = bestOf(playedRivals(rivals), (r) => rivalPoints(terms(r), r));
  const w = RIVAL_WEIGHTS;
  return (r) => {
    const t = terms(r);
    return `Meetings ${Math.round(t.meetings)}/${w.meetings} · Closeness ${Math.round(t.winCloseness)}/${w.winCloseness} · Rounds ${Math.round(t.roundCloseness)}/${w.roundCloseness}`
      + ` · Upsets ${Math.round(t.upsets)}/${w.upsets} · Evenness ×${(rivalEvenness(r) ** 2).toFixed(2)} · Total ${Math.round(rivalPoints(t, r))} of best ${Math.round(best)}`;
  };
}

/** A duo with its 0–100 friendship rating (`ratingPoints()` of `duoBlendedScorer()`, the number `H2HSection`'s
 *  rating circle shows). */
export interface RankedDuo {
  duo: DuoStats;
  rating: number;
}

/** A rivalry with its 0–100 rivalry rating (`ratingPoints()` of `rivalBlendedScorer()`). */
export interface RankedRival {
  rival: H2HStats;
  rating: number;
}

/** A 0–1 score as the 0–100 rating the UI shows. It rounds down, so only the best pair reads 100 and
 *  two pairs a hair apart never share a number by rounding up; the nudge absorbs float error
 *  (`0.29 * 100` is 28.999…). */
export function ratingPoints(score: number): number {
  return Math.floor(score * 100 + 1e-9);
}

/** The `limit` highest-scoring `items`, best first, each built into a `R` with its score as a
 *  rounded 0–100 rating. */
function rankBy<T, R>(items: T[], score: (item: T) => number, limit: number, make: (item: T, rating: number) => R): R[] {
  return items
    .map((item) => ({ item, raw: score(item) }))
    .sort((x, y) => y.raw - x.raw)
    .slice(0, limit)
    .map(({ item, raw }) => make(item, ratingPoints(raw)));
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
