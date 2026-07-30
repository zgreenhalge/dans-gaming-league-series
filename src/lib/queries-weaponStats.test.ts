/**
 * Regression harness for queries/weaponStats.ts (#279) — getAllWeaponClassStats,
 * getAllEconomyStats. Exercises the player_match_stats -> matches -> weeks -> seasons join and
 * the season_id filter against the fixture DB's match-100 rows (week 10 -> season 1).
 *
 * Run:  npx tsx src/lib/queries-weaponStats.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getAllWeaponClassStats, getAllEconomyStats } from './queries';
import { test, report } from './test-support/miniTest';

async function main() {
  await test('getAllWeaponClassStats: resolves player/match/season and returns one row per category', async () => {
    const rows = await getAllWeaponClassStats();
    const alice = rows.filter((r) => r.player_id === 1);
    assert.equal(alice.length, 2);
    const rifle = alice.find((r) => r.weapon_category === 'rifle');
    assert.equal(rifle?.match_id, 100);
    assert.equal(rifle?.season_id, 1);
    assert.equal(rifle?.player_name, 'Alice');
    assert.equal(rifle?.shots_fired, 90);
    assert.equal(rifle?.rounds_played, 20);
  });

  await test('getAllWeaponClassStats: seasonId filters out rows from other seasons', async () => {
    const rows = await getAllWeaponClassStats(2);
    assert.equal(rows.length, 0);
  });

  await test('getAllEconomyStats: resolves player/match/season and returns one row per tier', async () => {
    const rows = await getAllEconomyStats();
    const bob = rows.filter((r) => r.player_id === 2);
    assert.equal(bob.length, 2);
    const fullBuy = bob.find((r) => r.economy_type === 'full_buy');
    assert.equal(fullBuy?.season_id, 1);
    assert.equal(fullBuy?.shots_hit, 30);
    const forceBuy = bob.find((r) => r.economy_type === 'force_buy');
    assert.equal(forceBuy?.rounds_played, 5);
  });

  report();
}

main();
