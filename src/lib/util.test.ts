/**
 * Unit tests for the pure, deterministic helpers in util.ts / maps.ts — the functions that
 * encode the project's hard invariants (canonical sort, played-match check, em-dash score parsing,
 * season pairing, and the shared rate derivation). These have all caused regressions before; lock
 * them down so a refactor can't silently change a ranking or a "did this match happen?" answer.
 *
 * Run (mirrors the EHOG parity test):
 *   npx tsx src/lib/util.test.ts
 *
 * No test framework — just `node:assert` and a tiny runner, to keep zero dependencies.
 */

import assert from 'node:assert/strict';
import {
  isPlayedScore,
  parseScore,
  extractSeasonNumber,
  canonicalSort,
  deriveRates,
} from './util';
import { mapSlug } from './maps';

let passed = 0;
const failures: string[] = [];

function approx(actual: number, expected: number, msg?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, msg ?? `expected ~${expected}, got ${actual}`);
}

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
  }
}

// --- isPlayedScore: null and "0-0" placeholders are NOT played (S3 pre-staged rows) ---
test('isPlayedScore: real score is played', () => {
  assert.equal(isPlayedScore('13-9'), true);
  assert.equal(isPlayedScore('13 – 9'), true); // em-dash
});
test('isPlayedScore: null / undefined / empty are not played', () => {
  assert.equal(isPlayedScore(null), false);
  assert.equal(isPlayedScore(undefined), false);
  assert.equal(isPlayedScore(''), false);
});
test('isPlayedScore: "0-0" placeholders (hyphen, em-dash, spaced) are not played', () => {
  assert.equal(isPlayedScore('0-0'), false);
  assert.equal(isPlayedScore('0 - 0'), false);
  assert.equal(isPlayedScore('0 – 0'), false);
});
test('isPlayedScore: a real 0-N or N-0 result IS played', () => {
  assert.equal(isPlayedScore('13-0'), true);
  assert.equal(isPlayedScore('0-13'), true);
});

// --- parseScore: handles both hyphen and em-dash ---
test('parseScore: hyphen and em-dash both parse', () => {
  assert.deepEqual(parseScore('13-9'), { shirts: 13, skins: 9 });
  assert.deepEqual(parseScore('13 – 9'), { shirts: 13, skins: 9 });
});
test('parseScore: null/garbage returns null', () => {
  assert.equal(parseScore(null), null);
  assert.equal(parseScore('not a score'), null);
});

// --- extractSeasonNumber: name-based season pairing ---
test('extractSeasonNumber: pulls the number from a season name', () => {
  assert.equal(extractSeasonNumber('Season 3'), 3);
  assert.equal(extractSeasonNumber('Season 12 Gauntlet'), 12);
  assert.equal(extractSeasonNumber('season 4'), 4); // case-insensitive
});
test('extractSeasonNumber: no number returns null', () => {
  assert.equal(extractSeasonNumber('Preseason'), null);
});

// --- canonicalSort: WR% → RWR% → ADR, all descending ---
const row = (wr: number, rwr: number, adr: number) => ({
  win_rate_percentage: wr,
  rwr_percentage: rwr,
  overall_adr: adr,
});
test('canonicalSort: orders by WR% desc first', () => {
  const sorted = [row(50, 99, 99), row(80, 1, 1)].sort(canonicalSort);
  assert.equal(sorted[0].win_rate_percentage, 80);
});
test('canonicalSort: breaks WR% ties with RWR% desc', () => {
  const sorted = [row(50, 40, 99), row(50, 60, 1)].sort(canonicalSort);
  assert.equal(sorted[0].rwr_percentage, 60);
});
test('canonicalSort: breaks WR%+RWR% ties with ADR desc (never ADR alone)', () => {
  const sorted = [row(50, 50, 70), row(50, 50, 90)].sort(canonicalSort);
  assert.equal(sorted[0].overall_adr, 90);
});

// --- deriveRates: the single source for the four canonical-sort fields ---
test('deriveRates: computes WR / KD / RWR / ADR from totals', () => {
  const r = deriveRates({
    matches_played: 4,
    matches_won: 3,
    total_kills: 80,
    total_deaths: 40,
    total_rounds_played: 100,
    total_rounds_won: 55,
    total_damage: 9000,
  });
  approx(r.win_rate_percentage, 75);
  approx(r.kd_ratio, 2);
  approx(r.rwr_percentage, 55);
  approx(r.overall_adr, 90);
});
test('deriveRates: zero-guards (no division by zero, KD falls back to kills)', () => {
  const r = deriveRates({
    matches_played: 0,
    matches_won: 0,
    total_kills: 5,
    total_deaths: 0,
    total_rounds_played: 0,
    total_rounds_won: 0,
    total_damage: 0,
  });
  assert.equal(r.win_rate_percentage, 0);
  assert.equal(r.kd_ratio, 5); // deaths === 0 → kills, not Infinity
  assert.equal(r.rwr_percentage, 0);
  assert.equal(r.overall_adr, 0);
});

// --- mapSlug: user-typed map names → stable URL segments ---
test('mapSlug: lowercases, trims, and dashes non-alphanumerics', () => {
  assert.equal(mapSlug('  Palais  '), 'palais');
  assert.equal(mapSlug('Train Yard'), 'train-yard');
});

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
