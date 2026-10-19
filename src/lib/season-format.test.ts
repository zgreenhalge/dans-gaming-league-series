/**
 * Invariants for the fixed-length season planner: every player plays the same number of games, no
 * game seats a player twice, nobody plays more than the week shape allows, divisions keep their
 * matches inside, a reshuffled second half re-snakes, plans are reproducible from their seed, and
 * settings that can't keep those promises are refused with a reason instead.
 *
 * Run:  npx vitest run src/lib/season-format.test.ts
 */

import assert from 'node:assert/strict';
import { fromEhog, SIGMA_DEFAULT } from './ehog';
import {
  buildFormatPlan,
  formatIssues,
  groupSizes,
  draftDivisions,
  type FormatPlan,
  type FormatPlayer,
  type SeasonFormatSettings,
} from './season-format';
import { test, report } from './test-support/miniTest';

/** `n` players spread evenly from EHOG 90 down to 15, ids 1..n in rating order. */
function players(n: number): FormatPlayer[] {
  return Array.from({ length: n }, (_, i) => {
    const ehog = 90 - (75 * i) / Math.max(1, n - 1);
    return { id: i + 1, mu: fromEhog(ehog, SIGMA_DEFAULT), sigma: SIGMA_DEFAULT, ehog };
  });
}

const BASE: SeasonFormatSettings = {
  weeks: 8,
  weekShape: 'match',
  divisions: 1,
  draftBasis: 'ehog',
  draftOrder: 'snake',
  halfwayShuffle: false,
  ehogBalance: true,
  seed: 1,
};

function plan(n: number, settings: Partial<SeasonFormatSettings>, roster: FormatPlayer[] = players(n)): FormatPlan {
  const result = buildFormatPlan(roster, { ...BASE, ...settings });
  if (!result.ok) throw new Error(`expected a plan, got issues: ${result.issues.join(' ')}`);
  return result.plan;
}

/** Structural checks every plan must pass. */
function assertSound(p: FormatPlan, n: number, gamesEach: number, maxPerWeek: number) {
  const label = JSON.stringify(p.settings);
  assert.equal(p.weeks.length, p.settings.weeks, `${label}: week count`);
  const games = new Map<number, number>();
  for (const w of p.weeks) {
    const half = p.halves.find((h) => w.week >= h.firstWeek && w.week <= h.lastWeek)!;
    const perWeek = new Map<number, number>();
    for (const d of w.divisions) {
      const members = new Set(half.divisions[d.division - 1]);
      for (const g of d.games) {
        const seated = [...g.shirts, ...g.skins];
        assert.equal(new Set(seated).size, 4, `${label} week ${w.week}: a player is seated twice in one game`);
        for (const id of seated) {
          assert.ok(members.has(id), `${label} week ${w.week}: player ${id} plays outside their division`);
          games.set(id, (games.get(id) ?? 0) + 1);
          perWeek.set(id, (perWeek.get(id) ?? 0) + 1);
        }
        assert.ok(g.shirtsWinProb > 0 && g.shirtsWinProb < 1, `${label}: win probability out of range`);
      }
      for (const id of d.idlePlayerIds) assert.ok(!perWeek.has(id), `${label} week ${w.week}: idle player ${id} also plays`);
    }
    for (const [id, c] of perWeek) assert.ok(c <= maxPerWeek, `${label} week ${w.week}: player ${id} plays ${c} games`);
  }
  for (let id = 1; id <= n; id++) assert.equal(games.get(id) ?? 0, gamesEach, `${label}: player ${id} games`);
  assert.deepEqual(p.scorecard.gamesPerPlayer, { min: gamesEach, max: gamesEach });
  assert.ok(p.scorecard.maxSideImbalance <= 2, `${label}: side imbalance ${p.scorecard.maxSideImbalance}`);
}

test('draftDivisions deals a ranking as a snake, straight or in tiers', () => {
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.deepEqual(draftDivisions(ten, 2, 'snake'), [[1, 4, 5, 8, 9], [2, 3, 6, 7, 10]]);
  assert.deepEqual(draftDivisions([1, 2, 3, 4, 5, 6, 7], 3, 'snake'), [[1, 6, 7], [2, 5], [3, 4]]);
  assert.deepEqual(draftDivisions(ten, 2, 'straight'), [[1, 3, 5, 7, 9], [2, 4, 6, 8, 10]]);
  assert.deepEqual(draftDivisions([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], 2, 'tiered'), [[1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13]]);
});

test('groupSizes uses groups of 4 and folds the remainder into one group of 5-7', () => {
  assert.deepEqual(groupSizes(7), [7]);
  assert.deepEqual(groupSizes(10), [4, 6]);
  assert.deepEqual(groupSizes(13), [4, 4, 5]);
  assert.deepEqual(groupSizes(16), [4, 4, 4, 4]);
});

test('formatIssues refuses divisions smaller than a 2v2', () => {
  assert.equal(formatIssues(7, { ...BASE, divisions: 2 }).length, 1);
  assert.deepEqual(formatIssues(8, { ...BASE, divisions: 2 }), []);
  assert.equal(formatIssues(3, BASE).length, 1);
});

test('formatIssues refuses odd-group seasons with an odd number of weeks per half', () => {
  assert.equal(formatIssues(13, { ...BASE, weekShape: 'group', weeks: 7 }).length, 1);
  assert.equal(formatIssues(13, { ...BASE, weekShape: 'group', weeks: 6, divisions: 2, halfwayShuffle: true }).length, 1);
  assert.deepEqual(formatIssues(12, { ...BASE, weekShape: 'group', weeks: 7 }), []);
  assert.deepEqual(formatIssues(13, { ...BASE, weekShape: 'group', weeks: 8 }), []);
});

test('one league, one match a week: equal games and everyone meets everyone', () => {
  for (const n of [7, 13]) {
    const p = plan(n, {});
    assertSound(p, n, 8, 2);
    assert.equal(p.scorecard.pairsNeverMet, 0, `n=${n}: every pair meets`);
    assert.equal(p.halves.length, 1);
  }
});

test('one league, a group a week: two games a week, everyone partners everyone at 10 players', () => {
  const p = plan(10, { weekShape: 'group' });
  assertSound(p, 10, 16, 2);
  assert.equal(p.scorecard.pairsPartnered, 45);
  for (const w of p.weeks) {
    for (const d of w.divisions) {
      assert.deepEqual(d.idlePlayerIds, [], `week ${w.week}: nobody sits out a group week`);
      const byGroup = new Map<number, string[]>();
      for (const g of d.games) {
        const key = [[...g.shirts].sort().join('+'), [...g.skins].sort().join('+')].sort().join(' v ');
        const seen = byGroup.get(g.group!) ?? [];
        assert.ok(!seen.includes(key), `week ${w.week}: group ${g.group} replays the same teams`);
        byGroup.set(g.group!, [...seen, key]);
      }
    }
  }
});

test('odd groups even out over the season', () => {
  assertSound(plan(13, { weekShape: 'group' }), 13, 16, 3);
});

test('two divisions with a halfway shuffle re-snake the second half', () => {
  const p = plan(13, { divisions: 2, halfwayShuffle: true });
  assertSound(p, 13, 8, 2);
  assert.equal(p.halves.length, 2);
  const [first, second] = p.halves;
  assert.equal(first.draftedBy, 'ehog');
  assert.equal(first.records, null);
  assert.deepEqual(first.divisions, draftDivisions(players(13).map((pl) => pl.id), 2, 'snake'));
  assert.equal(second.draftedBy, 'first-half-win-rate');
  assert.equal(second.firstWeek, 5);
  assert.ok(second.records, 'second half carries the simulated first-half records');
  for (const r of Object.values(second.records!)) assert.equal(r.wins + r.losses, 4);
  assert.deepEqual(second.divisions.map((d) => d.length).sort(), [6, 7]);
});

test('a win-rate draft ranks by the supplied records, a player without one at 50%', () => {
  // Reverse the EHOG order through records: player 8 has the best record, player 1 the worst.
  const roster = players(8).map((p) => ({ ...p, record: p.id === 4 ? null : { wins: p.id, losses: 8 - p.id } }));
  const p = plan(8, { divisions: 2, weeks: 4, draftBasis: 'win-rate', draftOrder: 'tiered' }, roster);
  // Win rates: 8 → 100%, 7 → 88%, 6 → 75%, 5 → 63%, then 4 (no record, 50%) ties nobody.
  assert.deepEqual(p.halves[0].divisions, [[8, 7, 6, 5], [4, 3, 2, 1]]);
  assert.equal(p.halves[0].draftedBy, 'win-rate');
  assert.equal(p.halves[0].records![8].wins, 8);
});

test('a tiered draft with a halfway shuffle promotes and relegates by first-half win rate', () => {
  const p = plan(8, { divisions: 2, weeks: 4, draftOrder: 'tiered', halfwayShuffle: true });
  assertSound(p, 8, 4, 2);
  const second = p.halves[1];
  const rate = (id: number) => second.records![id].wins / (second.records![id].wins + second.records![id].losses);
  const [top, bottom] = second.divisions;
  assert.ok(Math.min(...top.map(rate)) >= Math.max(...bottom.map(rate)), 'division 1 holds the best first-half records');
});

test('a random draft is reproducible from the seed and still sound', () => {
  const a = plan(10, { divisions: 2, draftBasis: 'random' });
  assertSound(a, 10, 8, 2);
  assert.deepEqual(plan(10, { divisions: 2, draftBasis: 'random' }).halves, a.halves);
});

test('divisions without a shuffle keep one seeding all season', () => {
  const p = plan(8, { divisions: 2, weeks: 4 });
  assertSound(p, 8, 4, 2);
  assert.equal(p.halves.length, 1);
});

test('the same players, settings and seed produce the same plan', () => {
  const a = plan(9, { weeks: 4 });
  const b = plan(9, { weeks: 4 });
  assert.deepEqual(a, b);
});

report();
