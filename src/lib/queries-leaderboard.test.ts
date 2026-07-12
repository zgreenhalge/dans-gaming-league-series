/**
 * Regression harness for queries.ts's leaderboard functions (#63) — getSeasonLeaderboard,
 * getCareerLeaderboard, getAllLeaderboards.
 *
 * Run:  npx tsx src/lib/queries-leaderboard.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';
import { canonicalSort } from './util';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getSeasonLeaderboard, getCareerLeaderboard, getAllLeaderboards } from './queries';

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

function assertCanonicallySorted(
  rows: { player_name: string; win_rate_percentage: number; rwr_percentage: number; overall_adr: number }[],
  label: string,
) {
  for (let i = 1; i < rows.length; i++) {
    assert.ok(
      canonicalSort(rows[i - 1], rows[i]) <= 0,
      `${label}: row ${i - 1} (${rows[i - 1].player_name}) should sort before/equal row ${i} (${rows[i].player_name})`,
    );
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
    matchesSnapshot('getCareerLeaderboard', rows);
  });

  await test('getAllLeaderboards() — one entry per season with leaderboard rows, snapshot', async () => {
    const map = await getAllLeaderboards();
    matchesSnapshot('getAllLeaderboards', map);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('\nFailures:\n');
    for (const f of failures) console.error(`✗ ${f}\n`);
    process.exit(1);
  }
}

main();
