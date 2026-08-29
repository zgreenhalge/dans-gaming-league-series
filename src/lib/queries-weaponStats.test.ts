/**
 * Regression harness for queries/weaponStats.ts (#279, #474, #481) — getAllWeaponClassStats,
 * getAllEconomyStats, getMatchWeaponClassStats, groupWeaponAccuracyByPlayer,
 * aggregateEconomyStats, resolveEconomyStat. Exercises the player_match_stats -> matches ->
 * weeks -> seasons join and the season_id filter against the fixture DB's match-100 rows
 * (week 10 -> season 1).
 *
 * Run:  npx vitest run src/lib/queries-weaponStats.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getAllWeaponClassStats, getAllEconomyStats, getMatchWeaponClassStats, groupWeaponAccuracyByPlayer, aggregateEconomyStats, resolveEconomyStat, type EconomyMatchRow } from './queries';
import { test, report } from './test-support/miniTest';

function economyRow(overrides: Partial<EconomyMatchRow> & Pick<EconomyMatchRow, 'player_id' | 'match_id' | 'economy_type'>): EconomyMatchRow {
  return {
    player_name: 'Alice', season_id: 1,
    shots_fired: 0, shots_hit: 0, headshot_hits: 0, damage_dealt: 0, rounds_played: 0,
    ...overrides,
  };
}

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

  // --- aggregateEconomyStats/resolveEconomyStat (#481) ---
  await test('aggregateEconomyStats: sums per-tier totals across matches, ignores other players', () => {
    const rows: EconomyMatchRow[] = [
      economyRow({ player_id: 1, match_id: 100, economy_type: 'eco', shots_fired: 5, shots_hit: 2, rounds_played: 2 }),
      economyRow({ player_id: 1, match_id: 200, economy_type: 'eco', shots_fired: 3, shots_hit: 1, rounds_played: 1 }),
      economyRow({ player_id: 1, match_id: 100, economy_type: 'full_buy', shots_fired: 10, shots_hit: 6, rounds_played: 3 }),
      economyRow({ player_id: 2, match_id: 100, economy_type: 'eco', shots_fired: 100, shots_hit: 100, rounds_played: 100 }),
    ];
    const stats = aggregateEconomyStats(rows, 1);
    assert.equal(stats.length, 2);
    const eco = stats.find((s) => s.economy_type === 'eco')!;
    assert.equal(eco.shots_fired, 8);
    assert.equal(eco.shots_hit, 3);
    assert.equal(eco.rounds_played, 3);
    const fullBuy = stats.find((s) => s.economy_type === 'full_buy')!;
    assert.equal(fullBuy.rounds_played, 3);
  });

  await test('resolveEconomyStat: null picks the tier with the most rounds played', () => {
    const stats = aggregateEconomyStats([
      economyRow({ player_id: 1, match_id: 100, economy_type: 'eco', rounds_played: 2 }),
      economyRow({ player_id: 1, match_id: 100, economy_type: 'full_buy', rounds_played: 8 }),
    ], 1);
    assert.equal(resolveEconomyStat(stats, null).economy_type, 'full_buy');
  });

  await test('resolveEconomyStat: an explicit tier the player never played returns a zeroed stat, not undefined', () => {
    const resolved = resolveEconomyStat([], 'force_buy');
    assert.equal(resolved.economy_type, 'force_buy');
    assert.equal(resolved.rounds_played, 0);
  });

  report();
}

await main();
