/**
 * Regression harness for queries.ts's EHOG functions (#63) — getPlayerEhogRating,
 * getAllEhogSnapshots, getSeasonEhogRatings, getBatchMatchRatingDeltas, getMatchRatingDeltas,
 * getPlayerRatings. getPlayerRatings covers all three player-rating fallback tiers: full history
 * (player 1), seed_ehog-only (player 6), and neither (player 7).
 *
 * Run:  npx tsx src/lib/queries-ehog.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import {
  getPlayerEhogRating,
  getAllEhogSnapshots,
  getSeasonEhogRatings,
  getBatchMatchRatingDeltas,
  getMatchRatingDeltas,
  getPlayerRatings,
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
  await test('getPlayerEhogRating(1) — full history across 2 matches, snapshot', async () => {
    const data = await getPlayerEhogRating(1);
    assert.equal(data.history.length, 2);
    matchesSnapshot('getPlayerEhogRating-1', data);
  });

  await test('getPlayerEhogRating(6) — Frank, no rating rows at all, current+history both empty', async () => {
    const data = await getPlayerEhogRating(6);
    assert.equal(data.currentRating, null);
    assert.deepEqual(data.history, []);
  });

  await test('getAllEhogSnapshots() — latest per player per season segment, snapshot', async () => {
    matchesSnapshot('getAllEhogSnapshots', await getAllEhogSnapshots());
  });

  await test('getSeasonEhogRatings(1) — latest rating per player for season 1, snapshot', async () => {
    matchesSnapshot('getSeasonEhogRatings-1', await getSeasonEhogRatings(1));
  });

  await test('getSeasonEhogRatings(3) — season with no matches returns {}', async () => {
    assert.deepEqual(await getSeasonEhogRatings(3), {});
  });

  await test('getBatchMatchRatingDeltas([100, 200]) — snapshot', async () => {
    const deltas = await getBatchMatchRatingDeltas([100, 200]);
    matchesSnapshot('getBatchMatchRatingDeltas', deltas);
  });

  await test('getMatchRatingDeltas(100) — snapshot', async () => {
    matchesSnapshot('getMatchRatingDeltas-100', await getMatchRatingDeltas(100));
  });

  await test('getPlayerRatings([1, 6, 7]) — full history, seed-only fallback, global default, snapshot', async () => {
    const ratings = await getPlayerRatings([1, 6, 7]);
    const byId = new Map(ratings.map((r) => [r.playerId, r]));
    assert.equal(byId.get(1)!.ehogRating, 1450); // from history
    assert.equal(byId.get(6)!.ehogRating, 1250); // seed_ehog fallback
    assert.notEqual(byId.get(7)!.ehogRating, 1250); // neither — global default
    matchesSnapshot('getPlayerRatings-1-6-7', ratings);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('\nFailures:\n');
    for (const f of failures) console.error(`✗ ${f}\n`);
    process.exit(1);
  }
}

main();
