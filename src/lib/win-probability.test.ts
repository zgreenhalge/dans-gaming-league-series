/**
 * The win-probability calculator's pure logic: a matchup's odds come from predictWinProbability(),
 * and rankSplits() lists the three 2v2 splits of four players most even first.
 *
 * Run:  npx vitest run src/lib/win-probability.test.ts
 */

import assert from 'node:assert/strict';
import { MU_DEFAULT, SIGMA_DEFAULT, predictWinProbability, toEhog, type PlayerRating } from './ehog';
import { evaluateMatchup, hasDuplicatePick, lopsidedness, rankSplits } from './win-probability';
import { test, report } from './test-support/miniTest';

function player(playerId: number, mu: number, sigma = 1): PlayerRating {
  return { playerId, mu, sigma, ehogRating: toEhog(mu, sigma) };
}

const A = player(1, MU_DEFAULT + 6);
const B = player(2, MU_DEFAULT + 2);
const C = player(3, MU_DEFAULT - 2);
const D = player(4, MU_DEFAULT - 6);

test('evaluateMatchup: reuses predictWinProbability and mirrors across sides', () => {
  const m = evaluateMatchup([A, B], [C, D]);
  assert.equal(m.pShirtsWin, predictWinProbability([A, B], [C, D]));
  assert.ok(m.pShirtsWin > 0.5);
  const flipped = evaluateMatchup([C, D], [A, B]);
  assert.ok(Math.abs(m.pShirtsWin + flipped.pShirtsWin - 1) < 1e-9);
});

test('evaluateMatchup: provisional follows isProvisional', () => {
  assert.equal(evaluateMatchup([A, B], [C, D]).provisional, false);
  assert.equal(evaluateMatchup([A, B], [C, player(5, MU_DEFAULT, SIGMA_DEFAULT)]).provisional, true);
});

test('rankSplits: three distinct splits, most even first', () => {
  const splits = rankSplits([A, B, C, D]);
  assert.equal(splits.length, 3);
  const keys = splits.map((s) => s.shirts.map((p) => p.playerId).sort().join(','));
  assert.equal(new Set(keys).size, 3);
  for (const s of splits) assert.equal(s.shirts.length + s.skins.length, 4);
  for (let i = 1; i < splits.length; i++) assert.ok(lopsidedness(splits[i - 1]) <= lopsidedness(splits[i]));
  // Best + worst player against the middle two is the evenest split.
  assert.deepEqual(splits[0].shirts.map((p) => p.playerId), [1, 4]);
});

test('rankSplits: requires exactly four players', () => {
  assert.throws(() => rankSplits([A, B, C]));
});

test('hasDuplicatePick: ignores empty slots', () => {
  assert.equal(hasDuplicatePick([1, 2, null, null]), false);
  assert.equal(hasDuplicatePick([1, null, 1, null]), true);
  assert.equal(hasDuplicatePick([null, null, null, null]), false);
});

report();
