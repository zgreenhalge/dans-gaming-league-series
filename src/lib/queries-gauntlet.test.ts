/**
 * Regression harness for queries.ts's gauntlet functions (#63) — getGauntletStats,
 * getGauntletSeasonLeaderboard, getGauntletPodForMatch, getGauntletBracketShape,
 * getGauntletRounds, getAllGauntletSummaries.
 *
 * Run:  npx vitest run src/lib/queries-gauntlet.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';
import { test, report } from './test-support/miniTest';
import { deriveRates } from './util';
import type { LeaderboardRowWithId } from './types';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import {
  getGauntletStats,
  getGauntletSeasonLeaderboard,
  getGauntletPodForMatch,
  getGauntletBracketShape,
  getGauntletRounds,
  getAllGauntletSummaries,
} from './queries';

/** Guards against a duplicate inline reimplementation of `deriveRates()` silently reappearing. */
function assertRatesMatchDeriveRates(rows: LeaderboardRowWithId[], label: string) {
  for (const r of rows) {
    const rates = deriveRates(r);
    assert.equal(r.win_rate_percentage, rates.win_rate_percentage, `${label}: ${r.player_name} win_rate_percentage`);
    assert.equal(r.kd_ratio, rates.kd_ratio, `${label}: ${r.player_name} kd_ratio`);
    assert.equal(r.rwr_percentage, rates.rwr_percentage, `${label}: ${r.player_name} rwr_percentage`);
    assert.equal(r.overall_adr, rates.overall_adr, `${label}: ${r.player_name} overall_adr`);
  }
}

async function main() {
  await test('getGauntletStats() — career + bySeason across both gauntlets, snapshot', async () => {
    const stats = await getGauntletStats();
    assertRatesMatchDeriveRates(stats.career, 'getGauntletStats().career');
    matchesSnapshot('getGauntletStats', stats);
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

  report();
}

await main();
