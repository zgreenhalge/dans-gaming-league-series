/**
 * Pure, deterministic planner for a fixed-length regular season — the alternative to
 * `season-schedule.ts`'s round robin, whose length is set by the roster size (every pair partners
 * exactly once, so N players need N-1 or N weeks). Here the admin picks the length instead, and the
 * planner covers as much of the league as that length allows. Nothing here reads or writes the
 * database: it takes players with their EHOG state and returns a plan plus a scorecard, so the
 * Schedule Lab (`/schedule-lab`) can generate and compare plans freely.
 *
 * Settings (`SeasonFormatSettings`):
 * - `weeks` — season length.
 * - `weekShape` — `'match'`: each player plays about one 2v2 match a week; `'group'`: each week
 *   players meet in groups of 4–7 and play two games each back to back (see `groupGames()`).
 * - `divisions` — players are snake-seeded by EHOG into this many divisions; matches stay inside a
 *   division.
 * - `halfwayShuffle` — with more than one division, the second half re-snakes the divisions by
 *   first-half win rate. A plan is built before any game is played, so it simulates the first half:
 *   each game's winner is drawn from its predicted win probability with the plan's seed
 *   (`simulateRecords()`). In a real season the second half is drawn from actual results.
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
import { mulberry32, optimizeSideBalance, pairKey, type MatchPlan } from './season-schedule';

export type WeekShape = 'match' | 'group';

export interface SeasonFormatSettings {
  weeks: number;
  weekShape: WeekShape;
  divisions: number;
  halfwayShuffle: boolean;
  ehogBalance: boolean;
  /** Search seed — the same players and settings with the same seed always produce the same plan. */
  seed: number;
}

export interface FormatPlayer {
  id: number;
  mu: number;
  sigma: number;
  ehog: number;
}

export const FORMAT_MIN_WEEKS = 2;
export const FORMAT_MAX_WEEKS = 16;
export const FORMAT_MIN_PLAYERS = 4;
export const FORMAT_MAX_PLAYERS = 24;
/** A division needs at least one full 2v2. */
export const FORMAT_MIN_DIVISION_SIZE = 4;
/** A game counts as lopsided when either side's predicted win probability is above 0.5 + this. */
export const LOPSIDED_MARGIN = 0.25;

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
  /** Player ids per division (index 0 = division 1), in seeding order. */
  divisions: number[][];
  seededBy: 'ehog' | 'simulated-win-rate';
  /** Simulated first-half record per player id — set on a reshuffled half only. */
  firstHalfRecords: Record<number, { wins: number; losses: number }> | null;
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

/** Division sizes for `n` players in `k` divisions, as `snakeDivisions()` fills them. */
function divisionSizesFor(n: number, k: number): number[] {
  return Array.from({ length: k }, (_, d) => Math.floor(n / k) + (d < n % k ? 1 : 0));
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

  const sizes = divisionSizesFor(playerCount, settings.divisions);
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

/** Alternating snake: with k divisions, ranks 1..k go to divisions 1..k, ranks k+1..2k to k..1,
 * and so on — so each division gets an even share of the top, middle and bottom. */
export function snakeDivisions(rankedIds: number[], k: number): number[][] {
  const divisions: number[][] = Array.from({ length: k }, () => []);
  rankedIds.forEach((id, i) => {
    const row = Math.floor(i / k);
    const col = i % k;
    divisions[row % 2 === 0 ? col : k - 1 - col].push(id);
  });
  return divisions;
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

class WinProbTable {
  private readonly cache: Float64Array;
  constructor(private readonly ratings: PlayerRating[]) {
    const pairs = ratings.length * ratings.length;
    this.cache = new Float64Array(pairs * pairs).fill(Number.NaN);
  }
  /** Probability that team (a, b) beats team (c, d). */
  get(a: number, b: number, c: number, d: number): number {
    const n = this.ratings.length;
    const i = (a * n + b) * n * n + c * n + d;
    let p = this.cache[i];
    if (Number.isNaN(p)) {
      p = predictWinProbability([this.ratings[a], this.ratings[b]], [this.ratings[c], this.ratings[d]]);
      this.cache[i] = p;
    }
    return p;
  }
}

function searchHalf(
  input: HalfSearchInput,
  n: number,
  winProb: WinProbTable,
  ehogBalance: boolean,
  rand: () => number,
): HalfSearchResult {
  const { members, templates, gamesPerPlayer, history } = input;
  const size = members.length;
  const weeks = templates.length;
  const iterations = 10000 + 900 * size * weeks;
  // Per week: the games each slot plays in, and the games of each group — so a move only rescores
  // the games it actually touches.
  const slotGames = templates.map((t) => Array.from({ length: size }, (_, slot) => t.games.flatMap((g, gi) => (g.includes(slot) ? [gi] : []))));
  const groupGameIdx = templates.map((t) => {
    const byGroup = new Map<number, number[]>();
    t.group.forEach((grp, gi) => { if (grp !== null) byGroup.set(grp, [...(byGroup.get(grp) ?? []), gi]); });
    return byGroup;
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
    const bumpMate = (a: number, b: number, s: number) => {
      const i = a * n + b;
      const before = pairTerm(i);
      mates[i] += s;
      mates[b * n + a] += s;
      return pairTerm(i) - before;
    };
    const bumpOpp = (a: number, b: number, s: number) => {
      const i = a * n + b;
      const before = pairTerm(i);
      opps[i] += s;
      opps[b * n + a] += s;
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
      let delta = bumpMate(a, b, s) + bumpMate(c, d, s);
      delta += bumpOpp(a, c, s) + bumpOpp(a, d, s) + bumpOpp(b, c, s) + bumpOpp(b, d, s);
      delta += bumpGames(a, s) + bumpGames(b, s) + bumpGames(c, s) + bumpGames(d, s);
      if (ehogBalance) {
        const excess = Math.abs(winProb.get(a, b, c, d) - 0.5) - LOPSIDED_MARGIN;
        if (excess > 0) delta += s * WEIGHT.lopsided * excess * 100;
      }
      return delta;
    };
    /** Both teams as one number, independent of team order and seat order. */
    const gameKey = (w: number, g: number) => {
      const t1 = pairIndex(player(w, g, 0), player(w, g, 1), n);
      const t2 = pairIndex(player(w, g, 2), player(w, g, 3), n);
      return t1 < t2 ? t1 * n * n + t2 : t2 * n * n + t1;
    };
    /** Exact rematches (the same two teams twice in one week) inside the groups `gameIdx` touch —
     * only possible inside a group, since separate groups share no players. */
    const rematches = (w: number, gameIdx: number[]) => {
      const t = templates[w];
      if (t.group[0] === null) return 0;
      let count = 0;
      const seen: number[] = [];
      for (const gi of gameIdx) {
        const grp = t.group[gi]!;
        if (seen.includes(grp)) continue;
        seen.push(grp);
        const idx = groupGameIdx[w].get(grp)!;
        for (let x = 0; x < idx.length; x++) for (let y = x + 1; y < idx.length; y++) if (gameKey(w, idx[x]) === gameKey(w, idx[y])) count++;
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

    for (let it = 0; it < iterations; it++) {
      const temperature = 20 * Math.pow(0.0005, it / iterations);
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
        touched = gy.length === 0 ? gx : gx.length === 0 ? gy : mergeUnique(gx, gy);
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

/** A simulated record per player over `games`: each game's winner is drawn from its predicted
 * win probability. Stands in for real first-half results when a plan reshuffles at the halfway
 * point before any game has been played. */
function simulateRecords(games: FormatGame[], rand: () => number): Map<number, { wins: number; losses: number }> {
  const records = new Map<number, { wins: number; losses: number }>();
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
  const ratings: PlayerRating[] = players.map((p) => ({ playerId: p.id, mu: p.mu, sigma: p.sigma, ehogRating: p.ehog }));
  const winProb = new WinProbTable(ratings);
  const indexById = new Map(players.map((p, i) => [p.id, i]));
  const rand = mulberry32(settings.seed * 104729 + n);
  const history: PairCounts = { mates: new Int16Array(n * n), opps: new Int16Array(n * n) };
  const sizes = divisionSizesFor(n, settings.divisions);

  const halves: FormatHalf[] = [];
  const weeks: FormatWeek[] = [];
  let firstWeek = 1;
  for (const [h, halfWeeks] of halfLengths(settings).entries()) {
    let divisions: number[][];
    let records: Map<number, { wins: number; losses: number }> | null = null;
    const byEhog = (a: number, b: number) => players[indexById.get(b)!].ehog - players[indexById.get(a)!].ehog;
    if (h === 0) {
      divisions = snakeDivisions(players.map((p) => p.id).sort(byEhog), settings.divisions);
    } else {
      // The halfway reshuffle ranks by first-half win rate (simulated — see simulateRecords()),
      // with EHOG breaking ties.
      const simulated = simulateRecords(weeks.flatMap((w) => w.divisions.flatMap((d) => d.games)), rand);
      records = simulated;
      const rate = (id: number) => {
        const r = simulated.get(id);
        return r ? r.wins / (r.wins + r.losses) : 0;
      };
      divisions = snakeDivisions(players.map((p) => p.id).sort((a, b) => rate(b) - rate(a) || byEhog(a, b)), settings.divisions);
    }
    halves.push({
      half: h + 1,
      firstWeek,
      lastWeek: firstWeek + halfWeeks - 1,
      divisions,
      seededBy: h === 0 ? 'ehog' : 'simulated-win-rate',
      firstHalfRecords: records ? Object.fromEntries(records) : null,
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
          history.mates[pa * n + pb]++;
          history.mates[pb * n + pa]++;
          history.mates[pc * n + pd]++;
          history.mates[pd * n + pc]++;
          for (const x of [pa, pb]) for (const y of [pc, pd]) {
            history.opps[x * n + y]++;
            history.opps[y * n + x]++;
          }
          return {
            group: t.group[g] === null ? null : t.group[g]! + 1,
            shirts: [players[pa].id, players[pb].id],
            skins: [players[pc].id, players[pd].id],
            shirtsWinProb: winProb.get(pa, pb, pc, pd),
          };
        });
        halfWeeksOut[w].divisions.push({
          division: d + 1,
          games,
          idlePlayerIds: members.filter((m) => !playing.has(m)).map((m) => players[m].id),
        });
      });
    });
    weeks.push(...halfWeeksOut);
    firstWeek += halfWeeks;
  }

  assignSides(weeks, rand);
  return { ok: true, plan: { settings, halves, weeks, scorecard: scoreFormatPlan(players.map((p) => p.id), weeks) } };
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
export function scoreFormatPlan(playerIds: number[], weeks: FormatWeek[]): FormatScorecard {
  const games = weeks.flatMap((w) => w.divisions.flatMap((d) => d.games));
  const gameCount = new Map<number, number>();
  const sideBalance = new Map<number, number>();
  const teammateCount = new Map<string, number>();
  const met = new Set<string>();
  const teammates = new Map<number, Set<number>>(playerIds.map((id) => [id, new Set()]));
  let lopsidedGames = 0;

  for (const g of games) {
    for (const id of [...g.shirts, ...g.skins]) gameCount.set(id, (gameCount.get(id) ?? 0) + 1);
    for (const id of g.shirts) sideBalance.set(id, (sideBalance.get(id) ?? 0) + 1);
    for (const id of g.skins) sideBalance.set(id, (sideBalance.get(id) ?? 0) - 1);
    for (const [a, b] of [g.shirts, g.skins]) {
      const k = pairKey(a, b);
      teammateCount.set(k, (teammateCount.get(k) ?? 0) + 1);
      met.add(k);
      teammates.get(a)!.add(b);
      teammates.get(b)!.add(a);
    }
    for (const a of g.shirts) for (const b of g.skins) met.add(pairKey(a, b));
    if (Math.abs(g.shirtsWinProb - 0.5) > LOPSIDED_MARGIN) lopsidedGames++;
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
      if (teammateCount.has(k)) pairsPartnered++;
      if (!met.has(k)) pairsNeverMet++;
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
    lopsidedGames,
    maxSideImbalance: Math.max(0, ...playerIds.map((id) => Math.abs(sideBalance.get(id) ?? 0))),
  };
}
