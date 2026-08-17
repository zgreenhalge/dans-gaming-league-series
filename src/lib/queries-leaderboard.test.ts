/**
 * Regression harness for queries.ts's leaderboard functions (#63) — getSeasonLeaderboard,
 * getCareerLeaderboard, getAllLeaderboards.
 *
 * Run:  npx vitest run src/lib/queries-leaderboard.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';
import { canonicalSort, deriveRates } from './util';
import type { LeaderboardRowWithId } from './types';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getSeasonLeaderboard, getCareerLeaderboard, getAllLeaderboards } from './queries';
import { test, report } from './test-support/miniTest';

function assertCanonicallySorted(
  rows: { player_name: string; matches_won: number; rwr_percentage: number; overall_adr: number }[],
  label: string,
) {
  for (let i = 1; i < rows.length; i++) {
    assert.ok(
      canonicalSort(rows[i - 1], rows[i]) <= 0,
      `${label}: row ${i - 1} (${rows[i - 1].player_name}) should sort before/equal row ${i} (${rows[i].player_name})`,
    );
  }
}

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
  await test('getSeasonLeaderboard(1) — 4 played rows + 4 zero-stat rostered-but-unplayed rows, canonically sorted, snapshot', async () => {
    const rows = await getSeasonLeaderboard(1);
    // Players 1-4 have real stats from match 100; players 5-8 are rostered (via matches 101/102's
    // pre-staged player_match_stats rows) but have no player_season_leaderboard entry yet.
    assert.equal(rows.length, 8);
    assert.equal(rows.filter((r) => r.matches_played > 0).length, 4);
    assertCanonicallySorted(rows, 'getSeasonLeaderboard(1)');
    matchesSnapshot('getSeasonLeaderboard-1', rows);
  });

  await test('getSeasonLeaderboard(3) — active season, only zero-stat rostered players, snapshot', async () => {
    const rows = await getSeasonLeaderboard(3);
    // Match 400's rostered players (1, 5, 6, 7) haven't played yet.
    assert.equal(rows.length, 4);
    assert.ok(rows.every((r) => r.matches_played === 0));
    matchesSnapshot('getSeasonLeaderboard-3', rows);
  });

  await test('getSeasonLeaderboard(2) — gauntlet season has no player_season_leaderboard rows', async () => {
    assert.deepEqual(await getSeasonLeaderboard(2), []);
  });

  await test('getCareerLeaderboard() — sums across seasons, canonically sorted, snapshot', async () => {
    const rows = await getCareerLeaderboard();
    assertCanonicallySorted(rows, 'getCareerLeaderboard()');
    assertRatesMatchDeriveRates(rows, 'getCareerLeaderboard()');
    matchesSnapshot('getCareerLeaderboard', rows);
  });

  await test('getAllLeaderboards() — one entry per season with leaderboard rows, snapshot', async () => {
    const map = await getAllLeaderboards();
    matchesSnapshot('getAllLeaderboards', map);
  });

  report();
}

await main();
