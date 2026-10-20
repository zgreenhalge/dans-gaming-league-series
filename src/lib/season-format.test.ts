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
  draftDivisions,
  WEEK_UNIT,
  type FormatPlan,
  type FormatPlayer,
  type SeasonFormatSettings,
} from './season-format';
import { test, report } from './test-support/miniTest';

/** `n` players spread evenly from EHOG 90 down to 15, ids 1..n in rating order. */
function players(n: number): FormatPlayer[] {
  return Array.from({ length: n }, (_, i) => {
    const ehog = 90 - (75 * i) / Math.max(1, n - 1);
    return { playerId: i + 1, mu: fromEhog(ehog, SIGMA_DEFAULT), sigma: SIGMA_DEFAULT, ehogRating: ehog };
  });
}

const BASE: SeasonFormatSettings = {
  weeks: 8,
  weekShape: 'match',
  divisions: 1,
  draftBasis: 'ehog',
  draftOrder: 'snake',
  tierSizes: null,
  halfwayShuffle: false,
  halfwayRedraft: 'win-rate',
  ehogBalance: true,
  seed: 1,
};

// Plans are deterministic and only read by the assertions, so tests share one build per input.
const planCache = new Map<string, FormatPlan>();

function plan(n: number, settings: Partial<SeasonFormatSettings>, roster: FormatPlayer[] = players(n)): FormatPlan {
  const key = JSON.stringify({ roster, settings });
  const cached = planCache.get(key);
  if (cached) return cached;
  const result = buildFormatPlan(roster, { ...BASE, ...settings });
  if (!result.ok) throw new Error(`expected a plan, got issues: ${result.issues.join(' ')}`);
  planCache.set(key, result.plan);
  return result.plan;
}

/** Each player's per-week game counts across a plan. */
function weeklyGames(p: FormatPlan): Map<number, number[]> {
  const out = new Map<number, number[]>();
  p.weeks.forEach((w, wi) => {
    for (const d of w.divisions) {
      for (const g of d.games) {
        for (const id of [...g.shirts, ...g.skins]) {
          const weeks = out.get(id) ?? Array.from({ length: p.weeks.length }, () => 0);
          weeks[wi]++;
          out.set(id, weeks);
        }
      }
    }
  });
  return out;
}

/** Structural checks every plan must pass. */
function assertSound(p: FormatPlan, n: number, gamesEach: number, maxPerWeek: number) {
  const label = JSON.stringify(p.settings);
  assert.equal(p.weeks.length, p.settings.weeks, `${label}: week count`);
  const weekly = weeklyGames(p);
  p.weeks.forEach((w, wi) => {
    const half = p.halves.find((h) => w.week >= h.firstWeek && w.week <= h.lastWeek)!;
    for (const d of w.divisions) {
      const members = new Set(half.divisions[d.division - 1]);
      for (const g of d.games) {
        const seated = [...g.shirts, ...g.skins];
        assert.equal(new Set(seated).size, 4, `${label} week ${w.week}: a player is seated twice in one game`);
        for (const id of seated) assert.ok(members.has(id), `${label} week ${w.week}: player ${id} plays outside their division`);
        assert.ok(g.shirtsWinProb > 0 && g.shirtsWinProb < 1, `${label}: win probability out of range`);
      }
      for (const id of d.idlePlayerIds) assert.equal(weekly.get(id)![wi], 0, `${label} week ${w.week}: idle player ${id} also plays`);
    }
  });
  for (let id = 1; id <= n; id++) {
    const weeks = weekly.get(id) ?? [];
    assert.equal(weeks.reduce((a, c) => a + c, 0), gamesEach, `${label}: player ${id} games`);
    assert.ok(Math.max(0, ...weeks) <= maxPerWeek, `${label}: player ${id} plays ${Math.max(...weeks)} games in a week`);
  }
  assert.deepEqual(p.scorecard.gamesPerPlayer, { min: gamesEach, max: gamesEach });
  assert.ok(p.scorecard.maxSideImbalance <= 2, `${label}: side imbalance ${p.scorecard.maxSideImbalance}`);
}

/** Every group in a group-week plan is four players playing exactly two games with different
 *  team splits, and each player's week is a bye (0), one group (2) or two groups (4). */
function assertPods(p: FormatPlan) {
  for (const [id, weeks] of weeklyGames(p)) for (const c of weeks) assert.ok(c === 0 || c === 2 || c === 4, `player ${id} plays ${c} games in a week`);
  for (const w of p.weeks) {
    for (const d of w.divisions) {
      const byGroup = new Map<number, string[]>();
      const members = new Map<number, Set<number>>();
      for (const g of d.games) {
        members.set(g.group!, new Set([...(members.get(g.group!) ?? []), ...g.shirts, ...g.skins]));
        const key = [[...g.shirts].sort().join('+'), [...g.skins].sort().join('+')].sort().join(' v ');
        const seen = byGroup.get(g.group!) ?? [];
        assert.ok(!seen.includes(key), `week ${w.week}: group ${g.group} replays the same teams`);
        byGroup.set(g.group!, [...seen, key]);
      }
      for (const [grp, games] of byGroup) assert.equal(games.length, 2, `week ${w.week}: group ${grp} plays ${games.length} games`);
      for (const [grp, ids] of members) assert.equal(ids.size, 4, `week ${w.week}: group ${grp} has ${ids.size} players`);
    }
  }
}

test('draftDivisions deals a ranking as a snake, straight or in tiers', () => {
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const thirteen = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  assert.deepEqual(draftDivisions(ten, [5, 5], 'snake'), [[1, 4, 5, 8, 9], [2, 3, 6, 7, 10]]);
  assert.deepEqual(draftDivisions([1, 2, 3, 4, 5, 6, 7], [3, 2, 2], 'snake'), [[1, 6, 7], [2, 5], [3, 4]]);
  assert.deepEqual(draftDivisions(ten, [5, 5], 'straight'), [[1, 3, 5, 7, 9], [2, 4, 6, 8, 10]]);
  assert.deepEqual(draftDivisions(thirteen, [7, 6], 'tiered'), [[1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13]]);
  assert.deepEqual(draftDivisions(thirteen, [4, 9], 'tiered'), [[1, 2, 3, 4], [5, 6, 7, 8, 9, 10, 11, 12, 13]]);
});

test('formatIssues refuses divisions smaller than a 2v2', () => {
  assert.equal(formatIssues(7, { ...BASE, divisions: 2 }).length, 1);
  assert.deepEqual(formatIssues(8, { ...BASE, divisions: 2 }), []);
  assert.equal(formatIssues(3, BASE).length, 1);
});

test('formatIssues accepts group seasons of any roster size and length', () => {
  for (const n of [7, 10, 13]) for (const weeks of [5, 7, 8]) assert.deepEqual(formatIssues(n, { ...BASE, weekShape: 'group', weeks }), [], `n=${n} weeks=${weeks}`);
});

test('formatIssues refuses a 4-player division two groups in one week', () => {
  // Divisions of 5 and 4 over 6 weeks need 8 groups each, so the 4-player division would play two
  // groups — four games over only three possible team splits — in some week.
  assert.equal(formatIssues(9, { ...BASE, weekShape: 'group', divisions: 2, weeks: 6 }).length, 1);
  assert.deepEqual(formatIssues(9, { ...BASE, weekShape: 'match', divisions: 2, weeks: 6 }), []);
  assert.deepEqual(formatIssues(8, { ...BASE, weekShape: 'group', divisions: 2, weeks: 6 }), []);
});

test('one league, one match a week: equal games and everyone meets everyone', () => {
  for (const n of [7, 13]) {
    const p = plan(n, {});
    assertSound(p, n, 8, 2);
    assert.equal(p.scorecard.pairsNeverMet, 0, `n=${n}: every pair meets`);
    assert.equal(p.halves.length, 1);
  }
});

test('one league, a group a week: groups of 4, everyone partners everyone at 10 players', () => {
  const p = plan(10, { weekShape: 'group' });
  assertSound(p, 10, 16, 4);
  assertPods(p);
  assert.equal(p.scorecard.pairsPartnered, 45);
});

test('a doubleheader week never replays the same matchup in a 4-player division', () => {
  // 9 players in divisions of 5 and 4 over 6 weeks: 8 games each, so the 4-player division plays
  // both of a doubleheader week's matches with the same four players.
  const p = plan(9, { divisions: 2, weeks: 6 });
  assertSound(p, 9, 8, 2);
  for (const w of p.weeks) {
    for (const d of w.divisions) {
      const keys = d.games.map((g) => [[...g.shirts].sort().join('+'), [...g.skins].sort().join('+')].sort().join(' v '));
      assert.equal(new Set(keys).size, keys.length, `week ${w.week} division ${d.division} replays a matchup`);
    }
  }
});

test('every doubleheader pays back a bye, and the scorecard counts the weeks they fall in', () => {
  for (const p of [plan(13, {}), plan(13, { weekShape: 'group' }), plan(13, { divisions: 2, halfwayShuffle: true })]) {
    const label = JSON.stringify(p.settings);
    const usual = WEEK_UNIT[p.settings.weekShape].games;
    const perPlayer = weeklyGames(p);
    for (const [id, weeks] of perPlayer) {
      assert.equal(weeks.filter((c) => c > usual).length, weeks.filter((c) => c < usual).length, `${label}: player ${id} doubleheaders vs byes`);
    }
    const all = [...perPlayer.values()];
    const weeksWhere = (test: (c: number) => boolean) => p.weeks.filter((_, wi) => all.some((weeks) => test(weeks[wi]))).length;
    assert.equal(p.scorecard.doubleheaderWeeks, weeksWhere((c) => c > usual));
    assert.equal(p.scorecard.byeWeeks, weeksWhere((c) => c < usual));
    assert.equal(p.scorecard.maxGamesInAWeek, Math.max(...all.flat()));
  }
});

test('group seasons round to the group count nearest one a week', () => {
  // 7 players can only split into whole groups at 4 or 8 groups each; over 5 weeks, 4 is nearer.
  const p = plan(7, { weekShape: 'group', weeks: 5 });
  assertSound(p, 7, 8, 4);
  assertPods(p);
});

test('a division that divides by 4 never seats the same four players in two groups of one week', () => {
  // Divisions of 9 and 8 over 6 weeks need 8 groups each, so the 8-player division plays three groups
  // in some weeks — its third must mix players from both of the first two.
  const p = plan(17, { weekShape: 'group', divisions: 2, weeks: 6 });
  assertSound(p, 17, 16, 4);
  assertPods(p);
  for (const w of p.weeks) {
    for (const d of w.divisions) {
      const groupPlayers = new Map<number, string>();
      for (const g of d.games) groupPlayers.set(g.group!, [...g.shirts, ...g.skins].sort((a, b) => a - b).join(','));
      const sets = [...groupPlayers.values()];
      assert.equal(new Set(sets).size, sets.length, `week ${w.week} division ${d.division}: two groups seat the same four players`);
    }
  }
});

test('group weeks give leftover players a bye, paid back by a second group another week', () => {
  for (const n of [7, 13]) {
    const p = plan(n, { weekShape: 'group' });
    assertSound(p, n, 16, 4);
    assertPods(p);
    assert.ok(p.scorecard.byeWeeks > 0, `n=${n}: a roster not divisible by 4 has bye weeks`);
  }
});

test('two divisions with a halfway shuffle re-snake the second half', () => {
  const p = plan(13, { divisions: 2, halfwayShuffle: true });
  assertSound(p, 13, 8, 2);
  assert.equal(p.halves.length, 2);
  const [first, second] = p.halves;
  assert.equal(first.draftedBy, 'ehog');
  assert.equal(first.records, null);
  assert.deepEqual(first.divisions, draftDivisions(players(13).map((pl) => pl.playerId), [7, 6], 'snake'));
  assert.equal(second.draftedBy, 'first-half-win-rate');
  assert.equal(second.firstWeek, 5);
  assert.ok(second.records, 'second half carries the simulated first-half records');
  for (const r of Object.values(second.records!)) assert.equal(r.wins + r.losses, 4);
  assert.deepEqual(second.divisions.map((d) => d.length).sort(), [6, 7]);
});

test('a win-rate draft ranks by the supplied records, a player without one at 50%', () => {
  // Reverse the EHOG order through records: player 8 has the best record, player 1 the worst.
  const roster = players(8).map((p) => ({ ...p, record: p.playerId === 4 ? null : { wins: p.playerId, losses: 8 - p.playerId } }));
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

test('tier sizes set each tiered division, and promotion keeps them', () => {
  const p = plan(13, { divisions: 2, draftOrder: 'tiered', tierSizes: [5, 8], halfwayShuffle: true });
  assertSound(p, 13, 8, 2);
  for (const half of p.halves) assert.deepEqual(half.divisions.map((d) => d.length), [5, 8]);
  assert.deepEqual(p.halves[0].divisions[0], [1, 2, 3, 4, 5]);
});

test('formatIssues checks tier sizes against the roster and the 4-player floor', () => {
  const tiered = { ...BASE, divisions: 2, draftOrder: 'tiered' as const };
  assert.equal(formatIssues(13, { ...tiered, tierSizes: [5, 7] }).length, 1, 'sizes must add up to the roster');
  assert.equal(formatIssues(13, { ...tiered, tierSizes: [3, 10] }).length, 1, 'a division under 4');
  assert.equal(formatIssues(13, { ...tiered, tierSizes: [13] }).length, 1, 'one size per division');
  assert.deepEqual(formatIssues(13, { ...tiered, tierSizes: [4, 9] }), []);
});

test('a balanced draft evens out division EHOG averages at least as well as a snake', () => {
  // Uneven gaps between ratings, so a plain snake isn't already the best split.
  const roster = players(12).map((p, i) => ({ ...p, ehogRating: [95, 90, 60, 58, 50, 49, 40, 30, 29, 20, 15, 12][i] }));
  const average = (ids: number[]) => ids.reduce((sum, id) => sum + roster[id - 1].ehogRating, 0) / ids.length;
  const spread = (divs: number[][]) => Math.max(...divs.map(average)) - Math.min(...divs.map(average));
  const balanced = plan(12, { divisions: 3, draftOrder: 'balanced', weeks: 4 }, roster);
  const snake = plan(12, { divisions: 3, draftOrder: 'snake', weeks: 4 }, roster);
  assertSound(balanced, 12, 4, 2);
  assert.ok(spread(balanced.halves[0].divisions) <= spread(snake.halves[0].divisions));
  assert.equal(formatIssues(12, { ...BASE, divisions: 3, draftOrder: 'balanced', draftBasis: 'random' }).length, 1);
});

test('a new-pairings re-draft brings more first-half strangers together than a win-rate re-draft', () => {
  const settings = { divisions: 2, halfwayShuffle: true };
  const fresh = plan(13, { ...settings, halfwayRedraft: 'new-pairings' });
  const byRate = plan(13, { ...settings, halfwayRedraft: 'win-rate' });
  assertSound(fresh, 13, 8, 2);
  assert.equal(fresh.halves[1].draftedBy, 'new-pairings');
  assert.deepEqual(fresh.halves[1].divisions.map((d) => d.length), [7, 6]);
  assert.ok(fresh.scorecard.pairsNeverMet <= byRate.scorecard.pairsNeverMet, `${fresh.scorecard.pairsNeverMet} vs ${byRate.scorecard.pairsNeverMet}`);
});

test('divisions without a shuffle keep one seeding all season', () => {
  const p = plan(8, { divisions: 2, weeks: 4 });
  assertSound(p, 8, 4, 2);
  assert.equal(p.halves.length, 1);
});

test('the scorecard counts only pairs that share a division in some half', () => {
  const fixed = plan(12, { weeks: 4, divisions: 2 });
  assert.equal(fixed.scorecard.distinctTeammates.possible, 5);
  assert.equal(fixed.scorecard.pairs, 30);
  assert.ok(fixed.scorecard.distinctTeammates.max <= 5);
  assert.ok(fixed.scorecard.pairsPartnered <= 30 && fixed.scorecard.pairsNeverMet <= 30);

  const redrafted = plan(12, { weeks: 4, divisions: 2, halfwayShuffle: true, halfwayRedraft: 'new-pairings' });
  const reachable = new Set<string>();
  for (const half of redrafted.halves) {
    for (const ids of half.divisions) for (const a of ids) for (const b of ids) if (a < b) reachable.add(`${a}:${b}`);
  }
  assert.equal(redrafted.scorecard.pairs, reachable.size);
  assert.ok(redrafted.scorecard.pairs > 30 && redrafted.scorecard.pairs <= 66);
  assert.ok(redrafted.scorecard.distinctTeammates.possible > 5 && redrafted.scorecard.distinctTeammates.possible <= 11);
  assert.ok(redrafted.scorecard.distinctTeammates.max <= redrafted.scorecard.distinctTeammates.possible);

  const single = plan(12, { weeks: 4 });
  assert.equal(single.scorecard.distinctTeammates.possible, 11);
  assert.equal(single.scorecard.pairs, 66);
});

test('a plan survives a structured-clone round trip unchanged, as it does through the worker', () => {
  const roster = players(8);
  const settings = { ...BASE, weeks: 4 };
  const result = buildFormatPlan(structuredClone(roster), structuredClone(settings));
  assert.deepEqual(structuredClone(result), buildFormatPlan(roster, settings));
});

test('the same players, settings and seed produce the same plan', () => {
  const a = plan(9, { weeks: 4 });
  const b = plan(9, { weeks: 4 });
  assert.deepEqual(a, b);
});

report();
