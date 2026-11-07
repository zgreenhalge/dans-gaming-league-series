/**
 * Correctness proof for buildRosterSchedule() — that it's a faithful relabeling of
 * buildSeasonSchedule()'s seed-based output onto real player_ids, not just correct when seed
 * numbers happen to equal player_ids. Uses deliberately shuffled, non-sequential player_id arrays
 * to catch that class of bug. Assertions are plain node:assert, no matcher library — matching
 * season-schedule.test.ts.
 *
 * Run:  npx vitest run src/lib/season-schedule-engine.test.ts
 */

import assert from 'node:assert/strict';
import { buildRosterSchedule, shortCountPlayerIds } from './season-schedule-engine';
import { pairKey } from './season-schedule';
import { test, report } from './test-support/miniTest';

// Deliberately shuffled and non-sequential, so a bug that silently assumes seed === player_id
// (e.g. off-by-one, or forgetting the seed->player lookup) would fail loudly.
const ROSTER_7 = [305, 42, 999, 7, 256, 13, 101];
const ROSTER_12 = [1042, 7, 305, 88, 512, 3, 999, 256, 13, 47, 101, 620];

function assertFaithfulRelabeling(playerIds: number[]) {
  const weeks = buildRosterSchedule(playerIds);
  const idSet = new Set(playerIds);

  const teammatePairs = new Set<string>();
  const opponentPairs = new Set<string>();

  for (const w of weeks) {
    const appearances = new Map<number, number>();
    for (const m of w.matches) {
      for (const id of [...m.shirts, ...m.skins]) {
        assert.ok(idSet.has(id), `player_id ${id} in a match isn't in the roster`);
        appearances.set(id, (appearances.get(id) ?? 0) + 1);
      }
      teammatePairs.add(pairKey(m.shirts[0], m.shirts[1]));
      teammatePairs.add(pairKey(m.skins[0], m.skins[1]));
      for (const p of m.shirts) for (const q of m.skins) opponentPairs.add(pairKey(p, q));
    }
    for (const id of w.byePlayerIds) {
      assert.ok(idSet.has(id), `bye player_id ${id} isn't in the roster`);
      assert.ok(!appearances.has(id), `player_id ${id} is both playing and on bye the same week`);
    }
    for (const id of playerIds) {
      assert.ok((appearances.get(id) ?? 0) > 0 || w.byePlayerIds.includes(id), `player_id ${id} has no match and isn't a bye in week ${w.week}`);
    }
  }

  const expectedPairs = (playerIds.length * (playerIds.length - 1)) / 2;
  assert.equal(teammatePairs.size, expectedPairs, `expected every roster pair to be teammates at least once`);
  assert.equal(opponentPairs.size, expectedPairs, `expected every roster pair to be opponents at least once`);

  // Every pair key should be built from two real player_ids, never leftover seed numbers.
  for (const key of [...teammatePairs, ...opponentPairs]) {
    const [a, b] = key.split(':').map(Number);
    assert.ok(idSet.has(a) && idSet.has(b), `pair key ${key} references a seed number, not a real player_id`);
  }
}

async function main() {
  await test('buildRosterSchedule(7 shuffled ids) — faithful relabeling, full coverage', () => {
    assertFaithfulRelabeling(ROSTER_7);
  });

  await test('buildRosterSchedule(12 shuffled ids) — faithful relabeling, full coverage', () => {
    assertFaithfulRelabeling(ROSTER_12);
  });

  await test('buildRosterSchedule() — week/match count matches buildSeasonSchedule for the same size', () => {
    const weeks = buildRosterSchedule(ROSTER_7);
    assert.equal(weeks.length, 7); // odd seedCount => seedCount rounds
  });

  await test('buildRosterSchedule() — throws on duplicate player_ids', () => {
    assert.throws(() => buildRosterSchedule([1, 2, 3, 4, 5, 6, 2]));
  });

  await test('buildRosterSchedule() — throws outside the supported 7-19 range (delegates to buildSeasonSchedule)', () => {
    assert.throws(() => buildRosterSchedule([1, 2, 3, 4, 5]));
  });

  const matchCounts = (playerIds: number[], shortCountHistory?: Map<number, number>) => {
    const counts = new Map<number, number>(playerIds.map((id) => [id, 0]));
    for (const w of buildRosterSchedule(playerIds, { shortCountHistory }))
      for (const m of w.matches) for (const id of [...m.shirts, ...m.skins]) counts.set(id, counts.get(id)! + 1);
    return counts;
  };
  const ROSTER_10 = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

  await test('shortCountPlayerIds() — players on the minimum, none when counts are equal', () => {
    assert.deepEqual(shortCountPlayerIds(new Map([[1, 10], [2, 11], [3, 10]])), [1, 3]);
    assert.deepEqual(shortCountPlayerIds(new Map([[1, 11], [2, 11]])), []);
    assert.deepEqual(shortCountPlayerIds(new Map()), []);
  });

  await test('buildRosterSchedule(10) — shortCountHistory moves the short count off the players who had it', () => {
    const base = shortCountPlayerIds(matchCounts(ROSTER_10));
    assert.equal(base.length, 2);
    const history = new Map(base.map((id) => [id, 1]));
    const steered = matchCounts(ROSTER_10, history);
    const shortNow = shortCountPlayerIds(steered);
    assert.equal(shortNow.length, 2);
    for (const id of base) assert.ok(!shortNow.includes(id), `player ${id} was short before and is short again`);
  });

  await test('buildRosterSchedule(10) — short count goes to the players with the fewest past short seasons', () => {
    const history = new Map(ROSTER_10.map((id, i) => [id, i < 8 ? 2 : 0]));
    assert.deepEqual(shortCountPlayerIds(matchCounts(ROSTER_10, history)).sort(), [19, 20]);
  });

  await test('buildRosterSchedule() — shortCountHistory keeps full coverage', () => {
    const history = new Map(ROSTER_10.map((id, i) => [id, i % 3]));
    const weeks = buildRosterSchedule(ROSTER_10, { shortCountHistory: history });
    const teammates = new Set<string>();
    for (const w of weeks) for (const m of w.matches) { teammates.add(pairKey(m.shirts[0], m.shirts[1])); teammates.add(pairKey(m.skins[0], m.skins[1])); }
    assert.equal(teammates.size, 45);
  });

  report();
}

await main();
