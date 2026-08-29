/**
 * Regression harness for queries/weaponStats.ts (#279, #474) — getAllWeaponClassStats,
 * getAllEconomyStats, getMatchWeaponClassStats, groupWeaponAccuracyByPlayer. Exercises the
 * player_match_stats -> matches -> weeks -> seasons join and the season_id filter against the
 * fixture DB's match-100 rows (week 10 -> season 1).
 *
 * Run:  npx vitest run src/lib/queries-weaponStats.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getAllWeaponClassStats, getAllEconomyStats, getMatchWeaponClassStats, groupWeaponAccuracyByPlayer } from './queries';
import { test, report } from './test-support/miniTest';

async function main() {
  await test('getAllWeaponClassStats: resolves player/match/season and returns one row per weapon, with category derived', async () => {
    const rows = await getAllWeaponClassStats();
    const alice = rows.filter((r) => r.player_id === 1);
    assert.equal(alice.length, 2);
    const ak47 = alice.find((r) => r.weapon === 'ak47');
    assert.equal(ak47?.match_id, 100);
    assert.equal(ak47?.season_id, 1);
    assert.equal(ak47?.player_name, 'Alice');
    assert.equal(ak47?.weapon_category, 'rifle');
    assert.equal(ak47?.shots_fired, 90);
    assert.equal(ak47?.rounds_played, 20);
  });

  await test('getAllWeaponClassStats: a pre-migration row with no weapon still derives its category from the stored column', async () => {
    const rows = await getAllWeaponClassStats();
    const legacyRow = rows.find((r) => r.player_id === 2 && r.weapon == null);
    assert.equal(legacyRow?.weapon_category, 'shotgun');
    assert.equal(legacyRow?.shots_fired, 8);
  });

  await test('getAllWeaponClassStats: seasonId filters out rows from other seasons', async () => {
    const rows = await getAllWeaponClassStats(2);
    assert.equal(rows.length, 0);
  });

  await test('getMatchWeaponClassStats: resolves one match\'s rows without a season_id (#474)', async () => {
    const rows = await getMatchWeaponClassStats(100);
    const alice = rows.filter((r) => r.player_id === 1);
    assert.equal(alice.length, 2);
    const ak47 = alice.find((r) => r.weapon === 'ak47');
    assert.equal(ak47?.match_id, 100);
    assert.equal(ak47?.season_id, -1);
    assert.equal(ak47?.player_name, 'Alice');
    assert.equal(ak47?.weapon_category, 'rifle');
    assert.equal(ak47?.shots_fired, 90);
  });

  await test('groupWeaponAccuracyByPlayer: sums every player\'s rows by weapon and by category in one pass (#474)', async () => {
    const rows = await getAllWeaponClassStats();
    const grouped = groupWeaponAccuracyByPlayer(rows);

    const alice = grouped.get(1)!;
    assert.deepEqual(alice.byWeapon.get('ak47'), { shots_fired: 90, shots_hit: 40, headshot_hits: 18, damage_dealt: 3200, rounds_played: 20 });
    assert.deepEqual(alice.byCategory.get('rifle'), { shots_fired: 90, shots_hit: 40, headshot_hits: 18, damage_dealt: 3200, rounds_played: 20 });
    assert.equal(alice.byWeapon.has('shotgun'), false); // not a real weapon key
    assert.equal(alice.byCategory.has('shotgun'), false); // Alice has no shotgun rows

    const bob = grouped.get(2)!;
    // Bob's rifle row (m4a1) and his pre-migration weapon-less shotgun row both roll up into
    // byCategory; only the rifle row (which has a `weapon`) reaches byWeapon.
    assert.deepEqual(bob.byWeapon.get('m4a1'), { shots_fired: 85, shots_hit: 32, headshot_hits: 12, damage_dealt: 2600, rounds_played: 19 });
    assert.equal(bob.byWeapon.has('shotgun'), false);
    assert.deepEqual(bob.byCategory.get('shotgun'), { shots_fired: 8, shots_hit: 2, headshot_hits: 0, damage_dealt: 90, rounds_played: 2 });

    assert.equal(grouped.has(3), true); // player 3 has an awp/sniper row
    assert.equal(grouped.get(3)!.byWeapon.has('awp'), true);
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
