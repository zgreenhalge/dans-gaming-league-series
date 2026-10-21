/**
 * Tests for the Friends and Rival rating scorers (`duoBlendedScorer`, `rivalBlendedScorer` and their
 * breakdown counterparts in `queries/h2h.ts`) against small hand-built leagues, one behaviour per
 * test. Their snapshot over the shared fixture league lives in `queries-h2h.test.ts`.
 *
 * Run:  npx vitest run src/lib/h2h-ratings.test.ts
 */

import assert from 'node:assert/strict';
import { duoStats, rivalStats } from './test-support/h2hFixtures';
import { test, report } from './test-support/miniTest';
import { duoBlendedScorer, duoBreakdownScorer, rivalBlendedScorer, rivalBreakdownScorer } from './h2h-ratings';
import type { H2HStats } from './h2h';

/** A duo with `games` games, `wins` of them won, on a 55% round win rate; override the rest. */
function duo(games: number, wins: number, overrides: Parameters<typeof duoStats>[0] = {}) {
  return duoStats({ gamesPlayed: games, wins, losses: games - wins, roundsWon: games * 11, roundsPlayed: games * 20, ...overrides });
}

/** A rivalry with the given record and per-side upset scores. */
const rival = (wins: [number, number], overrides: Partial<H2HStats> = {}) => rivalStats(1, 2, wins[0], wins[1], overrides);

// ─── Friends ─────────────────────────────────────────────────────────────────

test('duoBlendedScorer: the best duo reads 1 and every other duo reads lower', () => {
  const duos = [duo(8, 6, { winsAboveExpected: 1 }), duo(4, 3), duo(2, 1)];
  const score = duoBlendedScorer(duos);
  assert.equal(score(duos[0]), 1);
  assert.ok(score(duos[1]) < 1 && score(duos[2]) < score(duos[1]));
});

test('duoBlendedScorer: a perfect one-game duo does not outrank a long-standing one', () => {
  const longRunning = duo(8, 6, { winsAboveExpected: 1 });
  const oneGame = duo(1, 1, { winsAboveExpected: 0.7, adrLift: 0.5 });
  const score = duoBlendedScorer([longRunning, oneGame]);
  assert.ok(score(longRunning) > score(oneGame));
});

test('duoBlendedScorer: with equal games, a duo that beat the odds outranks one that only matched them', () => {
  const league = duo(8, 6);
  const beatOdds = duo(4, 3, { winsAboveExpected: 1.2 });
  const matchedOdds = duo(4, 3, { winsAboveExpected: 0 });
  const score = duoBlendedScorer([league, beatOdds, matchedOdds]);
  assert.ok(score(beatOdds) > score(matchedOdds));
});

test('duoBlendedScorer: results and odds decide a 4-0 duo over a 3-1 duo whose edge is a small ADR lift', () => {
  const league = duo(8, 6);
  const fourNil = duo(4, 4, { roundsWon: 44, roundsPlayed: 63, winsAboveExpected: 1.46, adrLift: -0.003 });
  const threeOne = duo(4, 3, { roundsWon: 48, roundsPlayed: 86, winsAboveExpected: 0.99, adrLift: 0.102 });
  const score = duoBlendedScorer([league, fourNil, threeOne]);
  assert.ok(score(fourNil) > score(threeOne));
});

test('duoBlendedScorer: negative odds and lift earn nothing rather than subtracting', () => {
  const league = duo(8, 6);
  const underperformed = duo(4, 3, { winsAboveExpected: -1, adrLift: -0.2 });
  const flat = duo(4, 3, { winsAboveExpected: 0, adrLift: 0 });
  const score = duoBlendedScorer([league, underperformed, flat]);
  assert.equal(score(underperformed), score(flat));
});

test('duoBlendedScorer: a league with no points reads 0, not NaN', () => {
  const score = duoBlendedScorer([]);
  assert.equal(score(duo(0, 0)), 0);
});

test('duoBreakdownScorer: lists every term out of its weight and the total against the best duo', () => {
  const duos = [duo(8, 6, { winsAboveExpected: 1 }), duo(4, 3)];
  const text = duoBreakdownScorer(duos)(duos[0]);
  assert.match(text, /^Games 25\/25 · Win rate \d+\/15 · Rounds \d+\/15 · Odds \d+\/30 · ADR lift \d+\/15 · Total \d+ of best \d+$/);
});

// ─── Rivals ──────────────────────────────────────────────────────────────────

test('rivalBlendedScorer: the best rivalry reads 1', () => {
  const rivals = [rival([6, 6], { aUpsetScore: 2, bUpsetScore: 2 }), rival([3, 2]), rival([1, 0])];
  const score = rivalBlendedScorer(rivals);
  assert.equal(score(rivals[0]), 1);
  assert.ok(score(rivals[1]) < 1);
});

test('rivalBlendedScorer: a lopsided record ranks below an even one with the same meetings', () => {
  const even = rival([5, 5]);
  const lopsided = rival([8, 2]);
  const score = rivalBlendedScorer([even, lopsided]);
  assert.ok(score(even) > score(lopsided));
});

test('rivalBlendedScorer: upsets only count when both sides land them', () => {
  const league = rival([6, 6]);
  const mutual = rival([5, 5], { aUpsetScore: 1.5, bUpsetScore: 1.5 });
  const oneSided = rival([5, 5], { aUpsetScore: 3, bUpsetScore: 0 });
  const score = rivalBlendedScorer([league, mutual, oneSided]);
  assert.ok(score(mutual) > score(oneSided));
});

test('rivalBlendedScorer: a perfectly even short rivalry can outrank a long lopsided one', () => {
  const longLopsided = rival([9, 3]);
  const shortEven = rival([2, 2], { aUpsetScore: 1, bUpsetScore: 1 });
  const score = rivalBlendedScorer([longLopsided, shortEven]);
  assert.ok(score(shortEven) > score(longLopsided));
});

test('rivalBlendedScorer: a league with no points reads 0, not NaN', () => {
  assert.equal(rivalBlendedScorer([])(rival([0, 0])), 0);
});

test('rivalBreakdownScorer: lists every term out of its weight, the evenness scaling and the total', () => {
  const rivals = [rival([5, 5]), rival([8, 2])];
  const text = rivalBreakdownScorer(rivals)(rivals[0]);
  assert.match(text, /^Meetings \d+\/30 · Closeness \d+\/20 · Rounds \d+\/20 · Upsets \d+\/30 · Evenness ×1\.00 · Total \d+ of best \d+$/);
});

report();
