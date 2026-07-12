/**
 * Regression harness for queries.ts's gauntlet functions (#63) — getGauntletStats,
 * getGauntletSeasonLeaderboard, getGauntletPodForMatch, getGauntletBracketShape,
 * getGauntletRounds, getAllGauntletSummaries.
 *
 * Run:  npx tsx src/lib/queries-gauntlet.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import {
  getGauntletStats,
  getGauntletSeasonLeaderboard,
  getGauntletPodForMatch,
  getGauntletBracketShape,
  getGauntletRounds,
  getAllGauntletSummaries,
} from './queries';

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      passed++;
    } catch (err) {
      failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
    }
  })();
}

async function main() {
  await test('getGauntletStats() — career + bySeason across both gauntlets, snapshot', async () => {
    matchesSnapshot('getGauntletStats', await getGauntletStats());
  });

  await test('getGauntletSeasonLeaderboard(2) — paired gauntlet, snapshot', async () => {
    matchesSnapshot('getGauntletSeasonLeaderboard-2', await getGauntletSeasonLeaderboard(2));
  });

  await test('getGauntletSeasonLeaderboard(4) — orphan gauntlet, snapshot', async () => {
    matchesSnapshot('getGauntletSeasonLeaderboard-4', await getGauntletSeasonLeaderboard(4));
  });

  await test('getGauntletSeasonLeaderboard(1) — non-gauntlet season has no playoff matches', async () => {
    assert.deepEqual(await getGauntletSeasonLeaderboard(1), []);
  });

  await test('getGauntletPodForMatch(200) — resolves via the .or() match1/match2 clause, snapshot', async () => {
    const pod = await getGauntletPodForMatch(200);
    assert.notEqual(pod, null);
    matchesSnapshot('getGauntletPodForMatch-200', pod);
  });

  await test('getGauntletPodForMatch(100) — non-gauntlet match has no pod', async () => {
    assert.equal(await getGauntletPodForMatch(100), null);
  });

  await test('getGauntletBracketShape(2) — one materialized, played, final pod, snapshot', async () => {
    const shape = await getGauntletBracketShape(2);
    assert.equal(shape.length, 1);
    assert.equal(shape[0].played, true);
    assert.equal(shape[0].materialized, true);
    matchesSnapshot('getGauntletBracketShape-2', shape);
  });

  await test('getGauntletBracketShape(1) — regular season has no pods', async () => {
    assert.deepEqual(await getGauntletBracketShape(1), []);
  });

  await test('getGauntletRounds(2) — one round, one match, snapshot', async () => {
    const rounds = await getGauntletRounds(2);
    assert.equal(rounds.length, 1);
    matchesSnapshot('getGauntletRounds-2', rounds);
  });

  await test('getAllGauntletSummaries() — both gauntlets, snapshot', async () => {
    const summaries = await getAllGauntletSummaries();
    assert.equal(summaries.size, 2);
    matchesSnapshot('getAllGauntletSummaries', summaries);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('\nFailures:\n');
    for (const f of failures) console.error(`✗ ${f}\n`);
    process.exit(1);
  }
}

main();
