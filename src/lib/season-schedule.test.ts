/**
 * Correctness proof for the regular-season matchup generator. buildTeammateRounds(): every pair
 * of seeds must appear as teammates in exactly one round, in the minimum possible number of
 * rounds. buildSeasonSchedule(): every pair must additionally play as opponents at least once,
 * every week has at most one bye, doubleheaderPolicy 'never' throws exactly when a whole team
 * would otherwise be left over, and each seed's shirts/skins split stays within a loose empirical
 * bound — for every roster size the league supports (7-19) plus a wider band for confidence.
 * Assertions are plain node:assert, no matcher library — matching gauntlet-bracket.test.ts / util.test.ts.
 *
 * Run:  npx vitest run src/lib/season-schedule.test.ts
 */

import assert from 'node:assert/strict';
import { buildTeammateRounds, buildSeasonSchedule, optimizeSideBalance, pairKey, type MatchPlan } from './season-schedule';
import { test, report } from './test-support/miniTest';

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

  for (let n = 7; n <= 19; n++) {
    await test(`buildSeasonSchedule(${n}) — every pair plays together and against, at most 1 bye/week`, () => {
      const weeks = buildSeasonSchedule(n);
      assert.equal(weeks.length, expectedRounds(n), `n=${n}: week count should match buildTeammateRounds`);

      const teammatePairs = new Set<string>();
      const opponentPairs = new Set<string>();

      for (const w of weeks) {
        const appearances = new Map<number, number>();
        for (const m of w.matches) {
          for (const seed of [...m.shirts, ...m.skins]) {
            appearances.set(seed, (appearances.get(seed) ?? 0) + 1);
          }
          teammatePairs.add(pairKey(m.shirts[0], m.shirts[1]));
          teammatePairs.add(pairKey(m.skins[0], m.skins[1]));
          for (const p of m.shirts) for (const q of m.skins) opponentPairs.add(pairKey(p, q));
        }

        assert.ok(w.byeSeeds.length <= 1, `n=${n} week ${w.week}: expected at most 1 bye (doubleheader should absorb the rest), got ${w.byeSeeds.length}`);

        let totalAppearances = 0;
        for (let seed = 1; seed <= n; seed++) {
          const count = appearances.get(seed) ?? 0;
          totalAppearances += count;
          if (count === 0) {
            assert.ok(w.byeSeeds.includes(seed), `n=${n} week ${w.week}: seed ${seed} has no match but isn't listed as a bye`);
          } else {
            assert.ok(count === 1 || count === 2, `n=${n} week ${w.week}: seed ${seed} appears ${count} times, expected 1 (normal) or 2 (doubleheader donor)`);
          }
        }
        assert.equal(totalAppearances, w.matches.length * 4, `n=${n} week ${w.week}: appearance total should match 4x match count`);
      }

      const expectedPairCount = (n * (n - 1)) / 2;
      assert.equal(teammatePairs.size, expectedPairCount, `n=${n}: every pair should play together at least once (${teammatePairs.size}/${expectedPairCount})`);
      assert.equal(opponentPairs.size, expectedPairCount, `n=${n}: every pair should play against each other at least once (${opponentPairs.size}/${expectedPairCount})`);
    });
  }

  for (const n of [8, 9, 12, 13, 16, 17]) {
    await test(`buildSeasonSchedule(${n}, 'never') — no leftover team, so 'never' is safe and byes stay <= 1`, () => {
      const weeks = buildSeasonSchedule(n, { doubleheaderPolicy: 'never' });
      for (const w of weeks) assert.ok(w.byeSeeds.length <= 1, `n=${n} week ${w.week}: unexpected multi-bye under 'never'`);
    });
  }

  for (const n of [7, 10, 11, 14, 15, 18, 19]) {
    await test(`buildSeasonSchedule(${n}, 'never') — throws: a whole team would be left over every round`, () => {
      assert.throws(() => buildSeasonSchedule(n, { doubleheaderPolicy: 'never' }));
    });
  }

  for (const n of [0, 1, 6, 20, 40]) {
    await test(`buildSeasonSchedule(${n}) — throws: outside the supported 7-19 range`, () => {
      assert.throws(() => buildSeasonSchedule(n));
    });
  }

  function balanceOf(weeks: ReturnType<typeof buildSeasonSchedule>): Map<number, number> {
    const balance = new Map<number, number>();
    for (const w of weeks) {
      for (const m of w.matches) {
        for (const s of m.shirts) balance.set(s, (balance.get(s) ?? 0) + 1);
        for (const s of m.skins) balance.set(s, (balance.get(s) ?? 0) - 1);
      }
    }
    return balance;
  }

  for (let n = 7; n <= 19; n++) {
    await test(`buildSeasonSchedule(${n}) — shirts/skins stay roughly balanced per seed`, () => {
      const balance = balanceOf(buildSeasonSchedule(n));
      // Best-effort optimization, not an exact guarantee — bounded empirically (observed max 2
      // across n=7-19, now that the season-wide local-search pass replaces the old per-match greedy
      // walk's ~5 empirical max) with headroom, to catch a real regression (e.g. the optimizer
      // getting stuck or dropped entirely) without being a flaky assertion on the exact optimum.
      for (const [seed, bal] of balance) {
        assert.ok(Math.abs(bal) <= 4, `n=${n} seed ${seed}: shirts/skins imbalance ${bal}, expected within +/-4`);
      }
    });
  }

  for (const n of [7, 13, 19]) {
    for (const skew of [-8, 5]) {
      await test(`buildSeasonSchedule(${n}, initialBalance seed 1 = ${skew}) — trends back toward zero, not just flat`, () => {
        const balance = balanceOf(buildSeasonSchedule(n, { initialBalance: new Map([[1, skew]]) }));
        const seasonDelta = balance.get(1) ?? 0;
        const finalReal = skew + seasonDelta;
        assert.ok(
          Math.abs(finalReal) < Math.abs(skew),
          `n=${n}: seed 1 started at ${skew}, ended this season at ${finalReal} — expected real improvement, not just holding flat`,
        );
      });
    }
  }

  await test('optimizeSideBalance: converges to the better of two orientations regardless of the random starting side', () => {
    // A single match: with seed 1 already real-balance +5, the only way to reduce total |balance|
    // is to put them on skins — the better orientation is unique (not tied), so this must hold no
    // matter which side the search's internal randomization happens to start from.
    const matches: MatchPlan[] = [{ shirts: [1, 2], skins: [3, 4] }];
    optimizeSideBalance(matches, new Map([[1, 5]]), Math.random);
    assert.ok(matches[0].skins.includes(1), 'seed 1 (already +5) should end up on skins to reduce total imbalance');
  });

  await test('optimizeSideBalance: two identical pairings converge to a perfectly balanced pair via exactly one flip', () => {
    const matches: MatchPlan[] = [
      { shirts: [1, 2], skins: [3, 4] },
      { shirts: [1, 2], skins: [3, 4] },
    ];
    optimizeSideBalance(matches, new Map(), Math.random);
    const balance = balanceOf([{ week: 1, matches, byeSeeds: [] }]);
    for (const [seed, bal] of balance) {
      assert.equal(bal, 0, `seed ${seed}: expected perfectly balanced (0), got ${bal}`);
    }
  });

  report();
}

await main();
