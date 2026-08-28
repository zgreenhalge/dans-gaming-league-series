/**
 * Regression harness for queries/weaponStats.ts (#279, #474) — getAllWeaponClassStats,
 * getAllEconomyStats, getMatchWeaponClassStats, groupWeaponClassStatsByPlayer,
 * aggregateWeaponClassStat. Exercises the player_match_stats -> matches -> weeks -> seasons join
 * and the season_id filter against the fixture DB's match-100 rows (week 10 -> season 1).
 *
 * Run:  npx vitest run src/lib/queries-weaponStats.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getAllWeaponClassStats, getAllEconomyStats, getMatchWeaponClassStats, aggregateWeaponClassStat, groupWeaponClassStatsByPlayer } from './queries';
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

  await test('getMatchWeaponClassStats: resolves one match\'s rows without a season_id (#474)', async () => {
    const rows = await getMatchWeaponClassStats(100);
    const alice = rows.filter((r) => r.player_id === 1);
    assert.equal(alice.length, 2);
    const rifle = alice.find((r) => r.weapon_category === 'rifle');
    assert.equal(rifle?.match_id, 100);
    assert.equal(rifle?.season_id, -1);
    assert.equal(rifle?.player_name, 'Alice');
    assert.equal(rifle?.shots_fired, 90);
  });

  await test('aggregateWeaponClassStat: sums a player\'s rows for one category, zeroed when absent (#474)', async () => {
    const rows = await getAllWeaponClassStats();
    const rifle = aggregateWeaponClassStat(rows, 1, 'rifle');
    assert.deepEqual(rifle, { shots_fired: 90, shots_hit: 40, headshot_hits: 18, damage_dealt: 3200, rounds_played: 20 });

    const noShotgun = aggregateWeaponClassStat(rows, 1, 'shotgun');
    assert.deepEqual(noShotgun, { shots_fired: 0, shots_hit: 0, headshot_hits: 0, damage_dealt: 0, rounds_played: 0 });
  });

  await test('groupWeaponClassStatsByPlayer: sums every player\'s rows for one category in a single pass (#474)', async () => {
    const rows = await getAllWeaponClassStats();
    const grouped = groupWeaponClassStatsByPlayer(rows, 'rifle');
    assert.deepEqual(grouped.get(1), { shots_fired: 90, shots_hit: 40, headshot_hits: 18, damage_dealt: 3200, rounds_played: 20 });
    assert.deepEqual(grouped.get(2), { shots_fired: 85, shots_hit: 32, headshot_hits: 12, damage_dealt: 2600, rounds_played: 19 });
    assert.equal(grouped.has(3), false); // player 3 has a sniper row, not rifle
    assert.deepEqual(aggregateWeaponClassStat(rows, 1, 'rifle'), grouped.get(1));
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

await main();
