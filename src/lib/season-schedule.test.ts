/**
 * Correctness proof for buildTeammateRounds(): every pair of seeds must appear as teammates in
 * exactly one round, in the minimum possible number of rounds, for every roster size the league
 * supports (7-19) plus a wider band for confidence. No test framework — node:assert + a tiny
 * runner, matching gauntlet-bracket.test.ts / util.test.ts.
 *
 * Run:  npx tsx src/lib/season-schedule.test.ts
 */

import assert from 'node:assert/strict';
import { buildTeammateRounds } from './season-schedule';
import { test, report } from './test-support/miniTest';

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function expectedRounds(n: number): number {
  return n % 2 === 0 ? n - 1 : n;
}

/** Every unordered pair of seeds 1..n must appear as a team in exactly one round — no misses, no
 * duplicates — and nothing outside 1..n should ever appear (the phantom seed must never leak). */
function assertFullTeammateCoverage(n: number) {
  const rounds = buildTeammateRounds(n);
  assert.equal(rounds.length, expectedRounds(n), `n=${n}: expected ${expectedRounds(n)} rounds`);

  const seen = new Map<string, number>();
  for (const r of rounds) {
    const seedsThisRound = new Set<number>();
    for (const [a, b] of r.teams) {
      assert.ok(a >= 1 && a <= n && b >= 1 && b <= n, `n=${n} round ${r.round}: seed out of range in [${a},${b}]`);
      assert.notEqual(a, b, `n=${n} round ${r.round}: a seed can't be its own teammate`);
      assert.ok(!seedsThisRound.has(a) && !seedsThisRound.has(b), `n=${n} round ${r.round}: seed ${a} or ${b} appears in two teams the same round`);
      seedsThisRound.add(a);
      seedsThisRound.add(b);
      const key = pairKey(a, b);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    if (n % 2 === 0) {
      assert.equal(r.byeSeed, null, `n=${n} round ${r.round}: even n should never have a bye`);
      assert.equal(r.teams.length, n / 2, `n=${n} round ${r.round}: expected ${n / 2} teams`);
      assert.equal(seedsThisRound.size, n, `n=${n} round ${r.round}: every seed should have a teammate`);
    } else {
      assert.ok(r.byeSeed !== null && r.byeSeed >= 1 && r.byeSeed <= n, `n=${n} round ${r.round}: byeSeed out of range`);
      assert.ok(!seedsThisRound.has(r.byeSeed!), `n=${n} round ${r.round}: bye seed ${r.byeSeed} shouldn't also have a team`);
      assert.equal(r.teams.length, (n - 1) / 2, `n=${n} round ${r.round}: expected ${(n - 1) / 2} teams`);
      seedsThisRound.add(r.byeSeed!);
      assert.equal(seedsThisRound.size, n, `n=${n} round ${r.round}: every seed should appear (teamed or bye)`);
    }
  }

  // Every one of the n(n-1)/2 pairs covered exactly once.
  const expectedPairs = (n * (n - 1)) / 2;
  assert.equal(seen.size, expectedPairs, `n=${n}: expected ${expectedPairs} distinct pairs covered`);
  for (const [key, count] of seen) {
    assert.equal(count, 1, `n=${n}: pair ${key} covered ${count} times, expected exactly 1`);
  }

  if (n % 2 === 1) {
    // Every seed should sit out exactly once across the season (each paired with the phantom once).
    const byeCounts = new Map<number, number>();
    for (const r of rounds) byeCounts.set(r.byeSeed!, (byeCounts.get(r.byeSeed!) ?? 0) + 1);
    assert.equal(byeCounts.size, n, `n=${n}: every seed should get exactly one bye round`);
    for (const [seed, count] of byeCounts) {
      assert.equal(count, 1, `n=${n}: seed ${seed} got ${count} byes, expected exactly 1`);
    }
  }
}

async function main() {
  await test('buildTeammateRounds(4) — hand-checked: {12,34} {14,23} {13,24}', () => {
    const rounds = buildTeammateRounds(4);
    assert.deepEqual(
      rounds.map((r) => r.teams),
      [
        [[1, 2], [3, 4]],
        [[1, 4], [2, 3]],
        [[1, 3], [4, 2]],
      ],
    );
  });

  await test('buildTeammateRounds() — throws below seedCount 2', () => {
    assert.throws(() => buildTeammateRounds(1));
    assert.throws(() => buildTeammateRounds(0));
    assert.throws(() => buildTeammateRounds(1.5));
  });

  for (let n = 4; n <= 25; n++) {
    await test(`buildTeammateRounds(${n}) — full teammate coverage, minimum rounds, no phantom leak`, () => {
      assertFullTeammateCoverage(n);
    });
  }

  report();
}

main();
