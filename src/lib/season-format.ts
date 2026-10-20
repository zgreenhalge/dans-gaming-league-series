/**
 * Pure, deterministic planner for a fixed-length regular season — the alternative to
 * `season-schedule.ts`'s round robin, whose length is set by the roster size (every pair partners
 * exactly once, so N players need N-1 or N weeks). Here the admin picks the length instead, and the
 * planner covers as much of the league as that length allows. Nothing here reads or writes the
 * database: it takes players with their EHOG state and returns a plan plus a scorecard, so the
 * Schedule Lab (`/tools/schedule-lab`) can generate and compare plans freely.
 *
 * Settings (`SeasonFormatSettings`):
 * - `weeks` — season length.
 * - `weekShape` — `'match'`: each player plays about one 2v2 match a week; `'group'`: each week
 *   players meet in groups of 4–7 and play two games each back to back (see `groupGames()`).
 * - `divisions` — how many divisions the roster is drafted into; matches stay inside a division.
 * - `draftBasis` / `draftOrder` — how divisions are drafted: players are valued (`draftValues()`)
 *   by EHOG, by a win-loss record the caller supplies (`FormatPlayer.record`, e.g. a past season's
 *   or a career one), or at random, then dealt into divisions (`draftDivisions()`) as a snake
 *   (1-2-2-1, even skill spread), straight (1-2-1-2) or tiered (top players together — skill
 *   divisions, sized by `tierSizes`), or searched into the split whose division averages are
 *   closest (`balanced`, `balanceDivisions()`).
 * - `halfwayShuffle` / `halfwayRedraft` — with more than one division, the second half re-drafts
 *   the divisions. `'win-rate'` re-drafts by first-half win rate in the same order (with `tiered`,
 *   promotion and relegation); a plan is built before any game is played, so it simulates the
 *   first half — each game's winner drawn from its predicted win probability with the plan's seed
 *   (`simulateRecords()`); a real season uses actual results. `'new-pairings'` keeps the division
 *   sizes and searches for the split that puts the most first-half strangers together
 *   (`mostNewPairings()`).
 * - `ehogBalance` — steer team splits away from the most lopsided pairings (see
 *   `LOPSIDED_MARGIN`). EHOG only ever shapes who plays whom and which division a player starts
 *   in; standings stay Wins → RWR% → ADR (`canonicalSort()`).
 *
 * Every player plays the same number of games: a player who sits out a week has a doubleheader
 * somewhere else (`matchPhaseShape()`), and odd-sized groups alternate a longer and a shorter week
 * (`groupGames()`). Settings that can't keep that promise are refused with a reason by
 * `formatIssues()` rather than producing an uneven plan.
 *
 * Search: each (half, division) is a simulated-annealing search over which player fills which slot
 * of a fixed week template, and which of a game's three possible 2v2 splits is played. The cost
 * function, in order of weight: equal game counts, no exact rematch inside a group, no repeat
 * teammates, every pair meets (as teammates or opponents), lopsided games (only beyond the margin),
 * piled-up repeat opponents. Shirts/skins sides are assigned afterwards by `optimizeSideBalance()`
 * (`season-schedule.ts`) — flipping sides never changes a game's win probability, so the EHOG term
 * and side balance never compete.
 */

import { predictWinProbability, type PlayerRating } from './ehog';
import { snakeGroups } from './gauntlet-bracket';
import { collectCoveragePairs, mulberry32, optimizeSideBalance, pairKey, type MatchPlan } from './season-schedule';

export type WeekShape = 'match' | 'group';
/** What players are ranked by before they're dealt into divisions. */
export type DraftBasis = 'ehog' | 'win-rate' | 'random';
/** How players are dealt into divisions — see `draftDivisions()` and `balanceDivisions()`. */
export type DraftOrder = 'snake' | 'straight' | 'tiered' | 'balanced';
/** How the second half re-drafts divisions — see `halfwayShuffle`. */
export type HalfwayRedraft = 'win-rate' | 'new-pairings';

export interface SeasonFormatSettings {
  weeks: number;
  weekShape: WeekShape;
  divisions: number;
  draftBasis: DraftBasis;
  draftOrder: DraftOrder;
  /** `'tiered'` only: players per division, division 1 first; null splits the roster evenly. */
  tierSizes: number[] | null;
  halfwayShuffle: boolean;
  halfwayRedraft: HalfwayRedraft;
  ehogBalance: boolean;
  /** Search seed — the same players and settings with the same seed always produce the same plan. */
  seed: number;
}

export interface FormatRecord {
  wins: number;
  losses: number;
}

/** A player to plan for: their EHOG state (`PlayerRating`, as `getPlayerRatings()` returns it) plus
 *  the record a win-rate draft ranks by. */
export interface FormatPlayer extends PlayerRating {
  /** The record a `'win-rate'` draft ranks by; a player without one ranks at `UNKNOWN_WIN_RATE`. */
  record?: FormatRecord | null;
}

export const FORMAT_MIN_WEEKS = 2;
export const FORMAT_MAX_WEEKS = 16;
const FORMAT_MIN_PLAYERS = 4;
const FORMAT_MAX_PLAYERS = 24;
/** A division needs at least one full 2v2. */
export const FORMAT_MIN_DIVISION_SIZE = 4;
/** A game counts as lopsided when either side's predicted win probability is above 0.5 + this. */
export const LOPSIDED_MARGIN = 0.25;

/** True when a game's predicted win probability is outside the even range (`LOPSIDED_MARGIN`). */
export function isLopsided(winProb: number): boolean {
  return Math.abs(winProb - 0.5) > LOPSIDED_MARGIN;
}
/** Where a `'win-rate'` draft ranks a player with no record (a new player): the middle. */
const UNKNOWN_WIN_RATE = 0.5;

export interface FormatGame {
  /** 1-based group number within the division's week (`'group'` shape), else null. */
  group: number | null;
  shirts: [number, number];
  skins: [number, number];
  shirtsWinProb: number;
}

export interface FormatDivisionWeek {
  division: number; // 1-based
  games: FormatGame[];
  /** Division members with no game this week. */
  idlePlayerIds: number[];
}

export interface FormatWeek {
  week: number; // 1-based
  half: number; // 1-based
  divisions: FormatDivisionWeek[];
}

export interface FormatHalf {
  half: number;
  firstWeek: number;
  lastWeek: number;
  /** Player ids per division (index 0 = division 1), in draft order. */
  divisions: number[][];
  /** How this half's divisions were drafted: the season's draft basis, or (a reshuffled second
   *  half) the simulated first-half win rate or the most-new-pairings search. */
  draftedBy: DraftBasis | 'first-half-win-rate' | 'new-pairings';
  /** The records the ranking used, per player id — a `'win-rate'` draft's supplied records, or a
   *  reshuffled half's simulated first-half records; null otherwise. */
  records: Record<number, FormatRecord> | null;
}

export interface FormatScorecard {
  games: number;
  gamesPerPlayer: { min: number; max: number };
  /** Total player-weeks with no game. */
  idlePlayerWeeks: number;
  maxGamesInAWeek: number;
  distinctTeammates: { min: number; max: number; possible: number };
  pairs: number;
  pairsPartnered: number;
  pairsNeverMet: number;
  repeatTeammatePairs: number;
  lopsidedGames: number;
  maxSideImbalance: number;
}

export interface FormatPlan {
  settings: SeasonFormatSettings;
  halves: FormatHalf[];
  weeks: FormatWeek[];
  scorecard: FormatScorecard;
}

export type FormatResult = { ok: true; plan: FormatPlan } | { ok: false; issues: string[] };

// ---------------------------------------------------------------------------------------------
// Shapes: how many games a week holds and which slots play in each game

/** One week's games over slot indices 0..size-1; the search decides which player fills each slot.
 * `group` is the 0-based group index per game (`'group'` shape) or null (`'match'` shape). */
interface WeekTemplate {
  games: number[][];
  group: (number | null)[];
}

/** The three ways to split four players into two teams, as indices into a game's slot list. */
const SPLITS: [[number, number], [number, number]][] = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
];

/** Groups a division is split into each week: as many groups of 4 as possible, with the remainder
 * folded into one group of 5, 6 or 7. */
export function groupSizes(size: number): number[] {
  const fours = Math.floor(size / 4);
  const rest = size % 4;
  if (rest === 0) return Array.from({ length: fours }, () => 4);
  return [...Array.from({ length: fours - 1 }, () => 4), 4 + rest];
}

/** A group's games over its own slots. Every slot plays twice, except in groups of 5 and 7, where
 * the total can't split evenly: a "long" week gives two slots a third game and a "short" week gives
 * two slots a single game, so alternating them evens out at two games a week. A group's games share
 * players, so they're played back to back. */
function groupGames(size: number, long: boolean): number[][] {
  switch (size) {
    case 4:
      return [[0, 1, 2, 3], [0, 1, 2, 3]];
    case 5:
      return long ? [[0, 1, 2, 3], [0, 1, 2, 4], [0, 1, 3, 4]] : [[0, 1, 2, 3], [0, 1, 2, 4]];
    case 6:
      return [[0, 1, 2, 3], [0, 2, 4, 5], [1, 3, 4, 5]];
    case 7:
      return long
        ? [[0, 1, 2, 3], [4, 5, 6, 0], [1, 2, 4, 5], [3, 6, 0, 1]]
        : [[0, 1, 2, 3], [4, 5, 6, 0], [1, 2, 4, 5]];
    default:
      throw new Error(`groupGames: no group of ${size}`);
  }
}

function groupWeekTemplate(size: number, long: boolean): WeekTemplate {
  const games: number[][] = [];
  const group: number[] = [];
  let offset = 0;
  groupSizes(size).forEach((s, gi) => {
    for (const g of groupGames(s, long)) {
      games.push(g.map((slot) => slot + offset));
      group.push(gi);
    }
    offset += s;
  });
  return { games, group };
}

/** `matches` games filled round-robin over the slots, so slots at the start of the cycle get a
 * second game (a doubleheader) whenever the week holds more than `size / 4` matches, and slots at
 * the end get none (an idle week) when it holds fewer. */
function matchWeekTemplate(size: number, matches: number): WeekTemplate {
  const games: number[][] = [];
  let next = 0;
  for (let i = 0; i < matches; i++) {
    const game: number[] = [];
    while (game.length < 4) game.push(next++ % size);
    games.push(game);
  }
  return { games, group: games.map(() => null) };
}

/** The games-per-player target for a `'match'` half: the smallest count, at least one per week, that
 * every division can split into whole 2v2 matches (players × games must be a multiple of 4). Shared
 * across divisions so standings stay comparable league-wide. */
function matchGamesPerPlayer(divisionSizes: number[], weeks: number): number {
  let g = weeks;
  while (divisionSizes.some((s) => (s * g) % 4 !== 0)) g++;
  return g;
}

/** Matches per week for one division's `'match'` half: the total spread as evenly as the weeks
 * allow, with the extra matches placed evenly through the half rather than bunched at the start. */
function matchPhaseShape(size: number, weeks: number, gamesPerPlayer: number): number[] {
  const total = (size * gamesPerPlayer) / 4;
  const base = Math.floor(total / weeks);
  const extra = total % weeks;
  const counts = Array.from({ length: weeks }, () => base);
  for (let e = 0; e < extra; e++) counts[Math.floor(((e + 0.5) * weeks) / extra)]++;
  return counts;
}

function halfTemplates(size: number, weeks: number, shape: WeekShape, divisionSizes: number[]): { templates: WeekTemplate[]; gamesPerPlayer: number } {
  if (shape === 'group') {
    return { templates: Array.from({ length: weeks }, (_, i) => groupWeekTemplate(size, i % 2 === 0)), gamesPerPlayer: 2 * weeks };
  }
  const gamesPerPlayer = matchGamesPerPlayer(divisionSizes, weeks);
  return { templates: matchPhaseShape(size, weeks, gamesPerPlayer).map((m) => matchWeekTemplate(size, m)), gamesPerPlayer };
}

/** Division sizes for `n` players in `k` divisions, as even as possible, earlier divisions taking
 * any extra player: a straight draft's sizes and a tiered draft's default. A snake deals the same
 * sizes in another order (later divisions take the extras), which is all the rest of the plan
 * needs — it treats sizes as a set, or reads them from the drafted divisions. */
export function divisionSizesFor(n: number, k: number): number[] {
  return Array.from({ length: k }, (_, d) => Math.floor(n / k) + (d < n % k ? 1 : 0));
}

/** The division sizes a plan uses: a tiered draft's `tierSizes` when set, otherwise even. */
function divisionSizes(n: number, settings: SeasonFormatSettings): number[] {
  if (settings.draftOrder === 'tiered' && settings.tierSizes) return settings.tierSizes;
  return divisionSizesFor(n, settings.divisions);
}

/** Week counts of each half: one half, or two when the divisions reshuffle at the halfway point. */
function halfLengths(settings: SeasonFormatSettings): number[] {
  if (!reshuffles(settings)) return [settings.weeks];
  return [Math.ceil(settings.weeks / 2), Math.floor(settings.weeks / 2)];
}

function reshuffles(settings: SeasonFormatSettings): boolean {
  return settings.halfwayShuffle && settings.divisions > 1;
}

// ---------------------------------------------------------------------------------------------
// Feasibility

/** Reasons a player count and settings can't produce an even plan; empty when they can. */
export function formatIssues(playerCount: number, settings: SeasonFormatSettings): string[] {
  const issues: string[] = [];
  if (playerCount < FORMAT_MIN_PLAYERS) issues.push(`Pick at least ${FORMAT_MIN_PLAYERS} players.`);
  if (playerCount > FORMAT_MAX_PLAYERS) issues.push(`Pick at most ${FORMAT_MAX_PLAYERS} players.`);
  if (!Number.isInteger(settings.weeks) || settings.weeks < FORMAT_MIN_WEEKS || settings.weeks > FORMAT_MAX_WEEKS) {
    issues.push(`Weeks must be a whole number from ${FORMAT_MIN_WEEKS} to ${FORMAT_MAX_WEEKS}.`);
  }
  if (!Number.isInteger(settings.divisions) || settings.divisions < 1) issues.push('Divisions must be a whole number of at least 1.');
  if (issues.length > 0) return issues;

  if (settings.draftOrder === 'balanced' && settings.draftBasis === 'random' && settings.divisions > 1) {
    issues.push('A balanced draft evens out EHOG or win rate — pick one of those to draft by.');
    return issues;
  }
  if (settings.draftOrder === 'tiered' && settings.tierSizes) {
    const t = settings.tierSizes;
    if (t.length !== settings.divisions || t.some((v) => !Number.isInteger(v))) {
      issues.push(`Tier sizes need one whole number per division (${settings.divisions}).`);
      return issues;
    }
    const total = t.reduce((a, v) => a + v, 0);
    if (total !== playerCount) {
      issues.push(`Tier sizes add up to ${total}, but ${playerCount} players are picked.`);
      return issues;
    }
  }

  const sizes = divisionSizes(playerCount, settings);
  const smallest = Math.min(...sizes);
  if (smallest < FORMAT_MIN_DIVISION_SIZE) {
    issues.push(
      `${playerCount} players make a division of ${smallest} with ${settings.divisions} divisions — each needs at least ${FORMAT_MIN_DIVISION_SIZE} for a 2v2. At most ${Math.floor(playerCount / FORMAT_MIN_DIVISION_SIZE)} divisions fit.`,
    );
    return issues;
  }

  const halves = halfLengths(settings);
  if (settings.weekShape === 'group') {
    const oddGroups = sizes.some((s) => groupSizes(s).some((g) => g % 2 === 1));
    if (oddGroups && halves.some((w) => w % 2 === 1)) {
      issues.push(
        `A division of ${sizes.join('/')} needs a group of 5 or 7, which alternates 3-game and 1-game weeks — that needs an even number of weeks${halves.length > 1 ? ' in each half' : ''} for games to even out.`,
      );
    }
  } else {
    for (const w of halves) {
      const g = matchGamesPerPlayer(sizes, w);
      for (const s of sizes) {
        const busiest = Math.max(...matchPhaseShape(s, w, g));
        if (busiest * 4 > s * 2) {
          issues.push(`A division of ${s} can't fit ${g} games each into ${w} weeks without someone playing 3 in a week.`);
          return issues;
        }
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------------------------
// Divisions

/** Deals a ranking into divisions of `sizes`:
 * - `snake` — ranks 1..k go to divisions 1..k, ranks k+1..2k to k..1, and so on, so each division
 *   gets an even share of the top, middle and bottom.
 * - `straight` — ranks 1..k to divisions 1..k every round, so division 1 always picks first.
 * - `tiered` — the top players fill division 1, the next fill division 2, and so on (skill
 *   divisions).
 * Snake and straight deal sizes as even as possible (see `divisionSizesFor()`); `sizes` matters
 * for `tiered`. Each division lists its players in ranking order. */
export function draftDivisions(rankedIds: number[], sizes: number[], order: Exclude<DraftOrder, 'balanced'>): number[][] {
  const k = sizes.length;
  const divisions: number[][] = Array.from({ length: k }, () => []);
  if (order === 'tiered') {
    let next = 0;
    sizes.forEach((size, d) => {
      divisions[d] = rankedIds.slice(next, next + size);
      next += size;
    });
    return divisions;
  }
  if (order === 'snake') return snakeGroups(rankedIds, k);
  rankedIds.forEach((id, i) => divisions[i % k].push(id));
  return divisions;
}

/** Each player's draft value under `basis` (higher is better): EHOG, or win rate from `records` —
 * a player without one at `UNKNOWN_WIN_RATE`. Null for `random`, which has no value to rank by. */
function draftValues(players: FormatPlayer[], basis: DraftBasis, records: Map<number, FormatRecord>): Map<number, number> | null {
  if (basis === 'random') return null;
  if (basis === 'ehog') return new Map(players.map((p) => [p.playerId, p.ehogRating]));
  return new Map(
    players.map((p) => {
      const r = records.get(p.playerId);
      return [p.playerId, r && r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : UNKNOWN_WIN_RATE];
    }),
  );
}

/** Player ids best first by `values`, EHOG breaking ties; shuffled (seeded) when there are none. */
function rankByValues(players: FormatPlayer[], values: Map<number, number> | null, rand: () => number): number[] {
  const ids = players.map((p) => p.playerId);
  if (!values) return shuffled(ids, rand);
  const ehog = new Map(players.map((p) => [p.playerId, p.ehogRating]));
  return ids.sort((a, b) => values.get(b)! - values.get(a)! || ehog.get(b)! - ehog.get(a)!);
}

/** Largest gap between two divisions' average `values`. */
function averageSpread(divisions: number[][], values: Map<number, number>): number {
  const averages = divisions.map((d) => d.reduce((sum, id) => sum + values.get(id)!, 0) / d.length);
  return Math.max(...averages) - Math.min(...averages);
}

const SWAP_RESTARTS = 8;

/** Hill-climbs `divisions` (sizes fixed) by swapping two players between divisions while `score`
 * rises, from the given split and from `SWAP_RESTARTS` seeded shuffles of it, and returns the best
 * split found. Each division lists its players in their original order. */
function improveBySwaps(divisions: number[][], score: (divs: number[][]) => number, rand: () => number): number[][] {
  const sizes = divisions.map((d) => d.length);
  const order = divisions.flat();
  const position = new Map(order.map((id, i) => [id, i]));
  const sortBack = (divs: number[][]) => divs.map((d) => [...d].sort((a, b) => position.get(a)! - position.get(b)!));

  let best: { divs: number[][]; score: number } | null = null;
  for (let restart = 0; restart <= SWAP_RESTARTS; restart++) {
    let divs: number[][];
    if (restart === 0) {
      divs = divisions.map((d) => [...d]);
    } else {
      const ids = shuffled(order, rand);
      let next = 0;
      divs = sizes.map((size) => ids.slice(next, (next += size)));
    }
    let current = score(divs);
    for (let improved = true; improved; ) {
      improved = false;
      for (let a = 0; a < divs.length; a++) {
        for (let b = a + 1; b < divs.length; b++) {
          for (let i = 0; i < divs[a].length; i++) {
            for (let j = 0; j < divs[b].length; j++) {
              [divs[a][i], divs[b][j]] = [divs[b][j], divs[a][i]];
              const next = score(divs);
              if (next > current + 1e-9) {
                current = next;
                improved = true;
              } else {
                [divs[a][i], divs[b][j]] = [divs[b][j], divs[a][i]];
              }
            }
          }
        }
      }
    }
    if (!best || current > best.score + 1e-9) best = { divs: divs.map((d) => [...d]), score: current };
  }
  return sortBack(best!.divs);
}

/** The even-sized split whose divisions' average `values` are closest, searched from a snake. */
function balanceDivisions(rankedIds: number[], k: number, values: Map<number, number>, rand: () => number): number[][] {
  const start = draftDivisions(rankedIds, divisionSizesFor(rankedIds.length, k), 'snake');
  return improveBySwaps(start, (divs) => -averageSpread(divs, values), rand);
}

/** The split (same division sizes as `current`) that puts the most pairs who have never met —
 * teammates or opponents, per `met` — in the same division, with the divisions' EHOG averages as
 * close as possible breaking ties. */
function mostNewPairings(current: number[][], met: (a: number, b: number) => boolean, ehog: Map<number, number>, rand: () => number): number[][] {
  const score = (divs: number[][]) => {
    let fresh = 0;
    for (const d of divs) for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) if (!met(d[i], d[j])) fresh++;
    // EHOG averages span under 100, so the tiebreak never outweighs a single new pairing.
    return fresh - averageSpread(divs, ehog) / 1000;
  };
  return improveBySwaps(current, score, rand);
}

// ---------------------------------------------------------------------------------------------
// Search

const WEIGHT = {
  gameCount: 1000,
  rematch: 500,
  repeatTeammate: 40,
  unmet: 15,
  lopsided: 1, // × percentage points beyond LOPSIDED_MARGIN
  repeatOpponent: 2, // per meeting beyond the second
};
const RESTARTS = 3;
const SIDE_BALANCE_RUNS = 6;

/** League-wide pair counts — accumulate across halves so the second half avoids first-half pairs. */
interface PairCounts {
  mates: Int16Array;
  opps: Int16Array;
}

interface HalfSearchInput {
  members: number[]; // league indices of the division's players
  templates: WeekTemplate[];
  gamesPerPlayer: number;
  history: PairCounts;
}

interface HalfSearchResult {
  /** Per week: slot → league index. */
  slots: number[][];
  /** Per week: split index per game. */
  splits: number[][];
}

/** One number per matchup — both teams, independent of team order and seat order. */
function matchupKey(a: number, b: number, c: number, d: number, n: number): number {
  const t1 = pairIndex(a, b, n);
  const t2 = pairIndex(c, d, n);
  return t1 < t2 ? t1 * n * n + t2 : t2 * n * n + t1;
}

type WinProb = (a: number, b: number, c: number, d: number) => number;

/** `predictWinProbability()` by league index — the probability team (a, b) beats team (c, d) —
 * memoized once per matchup, whichever team or seat order asks for it. */
function memoWinProb(players: PlayerRating[]): WinProb {
  const n = players.length;
  const cache = new Map<number, number>();
  return (a, b, c, d) => {
    const key = matchupKey(a, b, c, d, n);
    let p = cache.get(key);
    if (p === undefined) {
      p = predictWinProbability([players[a], players[b]], [players[c], players[d]]);
      cache.set(key, pairIndex(a, b, n) < pairIndex(c, d, n) ? p : 1 - p);
      return p;
    }
    return pairIndex(a, b, n) < pairIndex(c, d, n) ? p : 1 - p;
  };
}

function searchHalf(
  input: HalfSearchInput,
  n: number,
  winProb: WinProb,
  ehogBalance: boolean,
  rand: () => number,
): HalfSearchResult {
  const { members, templates, gamesPerPlayer, history } = input;
  const size = members.length;
  const weeks = templates.length;
  const iterations = 10000 + 900 * size * weeks;
  // Per week: the games each slot plays in, and the games that could repeat each other — a group's
  // games (separate groups share no players), or every game of a match week (a doubleheader can
  // seat the same four players twice) — so a move only rescores the games it actually touches.
  const slotGames = templates.map((t) => Array.from({ length: size }, (_, slot) => t.games.flatMap((g, gi) => (g.includes(slot) ? [gi] : []))));
  const rematchBucket = (t: WeekTemplate, gi: number) => t.group[gi] ?? -1;
  const bucketGames = templates.map((t) => {
    const byBucket = new Map<number, number[]>();
    t.games.forEach((_, gi) => byBucket.set(rematchBucket(t, gi), [...(byBucket.get(rematchBucket(t, gi)) ?? []), gi]));
    return byBucket;
  });

  let best: { cost: number; result: HalfSearchResult } | null = null;
  for (let restart = 0; restart < RESTARTS; restart++) {
    const mates = Int16Array.from(history.mates);
    const opps = Int16Array.from(history.opps);
    const games = new Int16Array(n);
    const slots = templates.map(() => shuffled(members, rand));
    const splits = templates.map((t) => t.games.map(() => Math.floor(rand() * 3)));

    const pairTerm = (i: number) => {
      const m = mates[i];
      const o = opps[i];
      return (m > 1 ? WEIGHT.repeatTeammate * (m - 1) : 0) + (o > 2 ? WEIGHT.repeatOpponent * (o - 2) : 0) + (m + o === 0 ? WEIGHT.unmet : 0);
    };
    /** Adds `s` to a pair's teammate (`mates`) or opponent (`opps`) count; returns the cost change. */
    const bump = (counts: Int16Array, a: number, b: number, s: number) => {
      const i = a * n + b;
      const before = pairTerm(i);
      counts[i] += s;
      counts[b * n + a] += s;
      return pairTerm(i) - before;
    };
    const bumpGames = (p: number, s: number) => {
      const before = Math.abs(games[p] - gamesPerPlayer);
      games[p] += s;
      return WEIGHT.gameCount * (Math.abs(games[p] - gamesPerPlayer) - before);
    };
    const player = (w: number, g: number, k: number) => slots[w][templates[w].games[g][SPLITS[splits[w][g]][k >> 1][k & 1]]];
    /** Adds (s = 1) or removes (s = -1) one game's contribution; returns the cost change. */
    const applyGame = (w: number, g: number, s: number) => {
      const a = player(w, g, 0), b = player(w, g, 1), c = player(w, g, 2), d = player(w, g, 3);
      let delta = bump(mates, a, b, s) + bump(mates, c, d, s);
      delta += bump(opps, a, c, s) + bump(opps, a, d, s) + bump(opps, b, c, s) + bump(opps, b, d, s);
      delta += bumpGames(a, s) + bumpGames(b, s) + bumpGames(c, s) + bumpGames(d, s);
      if (ehogBalance) {
        const excess = Math.abs(winProb(a, b, c, d) - 0.5) - LOPSIDED_MARGIN;
        if (excess > 0) delta += s * WEIGHT.lopsided * excess * 100;
      }
      return delta;
    };
    const gameKey = (w: number, g: number) => matchupKey(player(w, g, 0), player(w, g, 1), player(w, g, 2), player(w, g, 3), n);
    /** Exact rematches (the same two teams twice in one week) among the games that could repeat
     * the games in `gameIdx` (see `bucketGames`). */
    const rematches = (w: number, gameIdx: number[]) => {
      const t = templates[w];
      let count = 0;
      const seen: number[] = [];
      for (const gi of gameIdx) {
        const bucket = rematchBucket(t, gi);
        if (seen.includes(bucket)) continue;
        seen.push(bucket);
        const keys = bucketGames[w].get(bucket)!.map((g) => gameKey(w, g));
        for (let x = 0; x < keys.length; x++) for (let y = x + 1; y < keys.length; y++) if (keys[x] === keys[y]) count++;
      }
      return WEIGHT.rematch * count;
    };

    let cost = 0;
    for (let i = 0; i < size; i++) {
      cost += WEIGHT.gameCount * gamesPerPlayer;
      for (let j = i + 1; j < size; j++) cost += pairTerm(members[i] * n + members[j]);
    }
    for (let w = 0; w < weeks; w++) {
      const all = templates[w].games.map((_, gi) => gi);
      for (const g of all) cost += applyGame(w, g, 1);
      cost += rematches(w, all);
    }

    // Cools geometrically from 20 to 0.01 over the run.
    const cooling = Math.pow(0.0005, 1 / iterations);
    let temperature = 20;
    for (let it = 0; it < iterations; it++, temperature *= cooling) {
      const w = Math.floor(rand() * weeks);
      const t = templates[w];

      // A move either swaps two slots' players within the week, or switches one game to one of its
      // other two team splits. Plain variables rather than move/undo closures: this loop runs a few
      // hundred thousand times per plan.
      const isSwap = rand() < 0.7;
      let x = 0;
      let y = 0;
      let g0 = 0;
      let oldSplit = 0;
      let newSplit = 0;
      let touched: number[];
      if (isSwap) {
        x = Math.floor(rand() * size);
        y = Math.floor(rand() * size);
        if (x === y) continue;
        const gx = slotGames[w][x];
        const gy = slotGames[w][y];
        touched = mergeUnique(gx, gy);
        if (touched.length === 0) continue;
      } else {
        g0 = Math.floor(rand() * t.games.length);
        oldSplit = splits[w][g0];
        newSplit = (oldSplit + 1 + Math.floor(rand() * 2)) % 3;
        touched = [g0];
      }

      let delta = -rematches(w, touched);
      for (const g of touched) delta += applyGame(w, g, -1);
      if (isSwap) swap(slots[w], x, y);
      else splits[w][g0] = newSplit;
      for (const g of touched) delta += applyGame(w, g, 1);
      delta += rematches(w, touched);

      if (delta <= 0 || rand() < Math.exp(-delta / temperature)) {
        cost += delta;
      } else {
        for (const g of touched) applyGame(w, g, -1);
        if (isSwap) swap(slots[w], x, y);
        else splits[w][g0] = oldSplit;
        for (const g of touched) applyGame(w, g, 1);
      }
    }

    if (!best || cost < best.cost) {
      best = { cost, result: { slots: slots.map((s) => [...s]), splits: splits.map((s) => [...s]) } };
    }
  }
  return best!.result;
}

/** `a` and `b` merged, without duplicates (both are short, ascending game-index lists). */
function mergeUnique(a: number[], b: number[]): number[] {
  const out = [...a];
  for (const v of b) if (!out.includes(v)) out.push(v);
  return out;
}

/** A unique number for an unordered pair of league indices. */
function pairIndex(a: number, b: number, n: number): number {
  return a < b ? a * n + b : b * n + a;
}

function swap(arr: number[], i: number, j: number): void {
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}

function shuffled(items: number[], rand: () => number): number[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) swap(a, i, Math.floor(rand() * (i + 1)));
  return a;
}

// ---------------------------------------------------------------------------------------------
// Plan assembly

/** Counts a played game — team (a, b) against team (c, d), by league index — into `counts`. */
function recordGame(counts: PairCounts, n: number, a: number, b: number, c: number, d: number): void {
  const add = (arr: Int16Array, x: number, y: number) => {
    arr[x * n + y]++;
    arr[y * n + x]++;
  };
  add(counts.mates, a, b);
  add(counts.mates, c, d);
  for (const x of [a, b]) for (const y of [c, d]) add(counts.opps, x, y);
}

/** A simulated record per player over `games`: each game's winner is drawn from its predicted
 * win probability. Stands in for real first-half results when a plan reshuffles at the halfway
 * point before any game has been played. */
function simulateRecords(games: FormatGame[], rand: () => number): Map<number, FormatRecord> {
  const records = new Map<number, FormatRecord>();
  const add = (id: number, won: boolean) => {
    const r = records.get(id) ?? { wins: 0, losses: 0 };
    if (won) r.wins++;
    else r.losses++;
    records.set(id, r);
  };
  for (const g of games) {
    const shirtsWon = rand() < g.shirtsWinProb;
    for (const id of g.shirts) add(id, shirtsWon);
    for (const id of g.skins) add(id, !shirtsWon);
  }
  return records;
}

/** Builds a plan for `players` under `settings`, or the reasons it can't. */
export function buildFormatPlan(players: FormatPlayer[], settings: SeasonFormatSettings): FormatResult {
  const issues = formatIssues(players.length, settings);
  if (issues.length > 0) return { ok: false, issues };

  const n = players.length;
  const winProb = memoWinProb(players);
  const indexById = new Map(players.map((p, i) => [p.playerId, i]));
  const rand = mulberry32(settings.seed * 104729 + n);
  const history: PairCounts = { mates: new Int16Array(n * n), opps: new Int16Array(n * n) };
  const sizes = divisionSizes(n, settings);

  const halves: FormatHalf[] = [];
  const weeks: FormatWeek[] = [];
  let firstWeek = 1;
  for (const [h, halfWeeks] of halfLengths(settings).entries()) {
    let draftedBy: FormatHalf['draftedBy'];
    let records: Map<number, FormatRecord> | null = null;
    let divisions: number[][];
    if (h === 1 && settings.halfwayRedraft === 'new-pairings') {
      draftedBy = 'new-pairings';
      const met = (a: number, b: number) => {
        const i = indexById.get(a)! * n + indexById.get(b)!;
        return history.mates[i] + history.opps[i] > 0;
      };
      divisions = mostNewPairings(halves[0].divisions, met, new Map(players.map((p) => [p.playerId, p.ehogRating])), rand);
    } else {
      let basis: DraftBasis;
      if (h === 0) {
        draftedBy = basis = settings.draftBasis;
        if (basis === 'win-rate') records = new Map(players.flatMap((p) => (p.record ? [[p.playerId, p.record] as const] : [])));
      } else {
        // The halfway re-draft values players by first-half win rate (simulated — see
        // simulateRecords()), in the season's draft order.
        draftedBy = 'first-half-win-rate';
        basis = 'win-rate';
        records = simulateRecords(weeks.flatMap((w) => w.divisions.flatMap((d) => d.games)), rand);
      }
      const values = draftValues(players, basis, records ?? new Map());
      const ranked = rankByValues(players, values, rand);
      divisions =
        settings.draftOrder === 'balanced' && values
          ? balanceDivisions(ranked, settings.divisions, values, rand)
          : draftDivisions(ranked, sizes, settings.draftOrder === 'balanced' ? 'snake' : settings.draftOrder);
    }
    halves.push({
      half: h + 1,
      firstWeek,
      lastWeek: firstWeek + halfWeeks - 1,
      divisions,
      draftedBy,
      records: records ? Object.fromEntries(records) : null,
    });

    const halfWeeksOut: FormatWeek[] = Array.from({ length: halfWeeks }, (_, i) => ({ week: firstWeek + i, half: h + 1, divisions: [] }));
    divisions.forEach((divisionIds, d) => {
      const members = divisionIds.map((id) => indexById.get(id)!);
      const { templates, gamesPerPlayer } = halfTemplates(members.length, halfWeeks, settings.weekShape, sizes);
      const result = searchHalf({ members, templates, gamesPerPlayer, history }, n, winProb, settings.ehogBalance, rand);

      templates.forEach((t, w) => {
        const playing = new Set<number>();
        const games: FormatGame[] = t.games.map((slot, g) => {
          const [[a, b], [c, d2]] = SPLITS[result.splits[w][g]];
          const [pa, pb, pc, pd] = [slot[a], slot[b], slot[c], slot[d2]].map((s) => result.slots[w][s]);
          for (const p of [pa, pb, pc, pd]) playing.add(p);
          recordGame(history, n, pa, pb, pc, pd);
          return {
            group: t.group[g] === null ? null : t.group[g]! + 1,
            shirts: [players[pa].playerId, players[pb].playerId],
            skins: [players[pc].playerId, players[pd].playerId],
            shirtsWinProb: winProb(pa, pb, pc, pd),
          };
        });
        halfWeeksOut[w].divisions.push({
          division: d + 1,
          games,
          idlePlayerIds: members.filter((m) => !playing.has(m)).map((m) => players[m].playerId),
        });
      });
    });
    weeks.push(...halfWeeksOut);
    firstWeek += halfWeeks;
  }

  assignSides(weeks, rand);
  return { ok: true, plan: { settings, halves, weeks, scorecard: scoreFormatPlan(players.map((p) => p.playerId), weeks) } };
}

/** Labels each game's teams shirts/skins with `optimizeSideBalance()`, the search the round-robin
 * generator uses. That search minimizes the league's total imbalance, which over a long season can
 * still leave one player several sides off, so it runs `SIDE_BALANCE_RUNS` times and keeps the run
 * whose worst player is closest to even. Flipping a game's sides inverts its stored win probability
 * along with it. */
function assignSides(weeks: FormatWeek[], rand: () => number): void {
  const games = weeks.flatMap((w) => w.divisions.flatMap((d) => d.games));
  let best: { worst: number; total: number; plans: MatchPlan[] } | null = null;
  for (let run = 0; run < SIDE_BALANCE_RUNS; run++) {
    const plans: MatchPlan[] = games.map((g) => ({ shirts: g.shirts, skins: g.skins }));
    optimizeSideBalance(plans, new Map(), rand);
    const balance = new Map<number, number>();
    for (const m of plans) {
      for (const id of m.shirts) balance.set(id, (balance.get(id) ?? 0) + 1);
      for (const id of m.skins) balance.set(id, (balance.get(id) ?? 0) - 1);
    }
    const values = [...balance.values()].map(Math.abs);
    const worst = Math.max(...values);
    const total = values.reduce((a, v) => a + v, 0);
    if (!best || worst < best.worst || (worst === best.worst && total < best.total)) best = { worst, total, plans };
  }
  best!.plans.forEach((m, i) => {
    const g = games[i];
    if (m.shirts !== g.shirts) {
      g.shirtsWinProb = 1 - g.shirtsWinProb;
      g.shirts = m.shirts;
      g.skins = m.skins;
    }
  });
}

/** The comparison numbers for a plan — what the Schedule Lab shows side by side. */
function scoreFormatPlan(playerIds: number[], weeks: FormatWeek[]): FormatScorecard {
  const games = weeks.flatMap((w) => w.divisions.flatMap((d) => d.games));
  const { teammatePairs, opponentPairs } = collectCoveragePairs(games);
  const gameCount = new Map<number, number>();
  const sideBalance = new Map<number, number>();
  const teammateCount = new Map<string, number>();
  const teammates = new Map<number, Set<number>>(playerIds.map((id) => [id, new Set()]));

  for (const g of games) {
    for (const id of [...g.shirts, ...g.skins]) gameCount.set(id, (gameCount.get(id) ?? 0) + 1);
    for (const id of g.shirts) sideBalance.set(id, (sideBalance.get(id) ?? 0) + 1);
    for (const id of g.skins) sideBalance.set(id, (sideBalance.get(id) ?? 0) - 1);
    for (const [a, b] of [g.shirts, g.skins]) {
      const k = pairKey(a, b);
      teammateCount.set(k, (teammateCount.get(k) ?? 0) + 1);
      teammates.get(a)!.add(b);
      teammates.get(b)!.add(a);
    }
  }

  let maxGamesInAWeek = 0;
  let idlePlayerWeeks = 0;
  for (const w of weeks) {
    const perPlayer = new Map<number, number>();
    for (const d of w.divisions) {
      idlePlayerWeeks += d.idlePlayerIds.length;
      for (const g of d.games) for (const id of [...g.shirts, ...g.skins]) perPlayer.set(id, (perPlayer.get(id) ?? 0) + 1);
    }
    for (const c of perPlayer.values()) maxGamesInAWeek = Math.max(maxGamesInAWeek, c);
  }

  let pairs = 0;
  let pairsPartnered = 0;
  let pairsNeverMet = 0;
  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      pairs++;
      const k = pairKey(playerIds[i], playerIds[j]);
      if (teammatePairs.has(k)) pairsPartnered++;
      if (!teammatePairs.has(k) && !opponentPairs.has(k)) pairsNeverMet++;
    }
  }
  const counts = playerIds.map((id) => gameCount.get(id) ?? 0);
  const distinct = playerIds.map((id) => teammates.get(id)!.size);
  return {
    games: games.length,
    gamesPerPlayer: { min: Math.min(...counts), max: Math.max(...counts) },
    idlePlayerWeeks,
    maxGamesInAWeek,
    distinctTeammates: { min: Math.min(...distinct), max: Math.max(...distinct), possible: playerIds.length - 1 },
    pairs,
    pairsPartnered,
    pairsNeverMet,
    repeatTeammatePairs: [...teammateCount.values()].filter((c) => c > 1).length,
    lopsidedGames: games.filter((g) => isLopsided(g.shirtsWinProb)).length,
    maxSideImbalance: Math.max(0, ...playerIds.map((id) => Math.abs(sideBalance.get(id) ?? 0))),
  };
}
