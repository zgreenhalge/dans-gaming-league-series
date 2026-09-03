/**
 * Unit tests for `persistWeaponStats()`/`clearWeaponStats()` — the shared
 * `player_match_weapon_stats`/`player_match_economy_stats` persistence. Unlike
 * `sabremetrics.ts` (one row per player, upserted), this is delete-then-insert per match: a reparse
 * can produce a smaller bucket set than before (e.g. no sniper shots this time), and only deleting
 * every existing row first guarantees no stale bucket survives. Against `fakeSupabase.ts` via
 * `__setTestAdminClient`, mirroring `sabremetrics.test.ts`'s setup.
 *
 * Run:  npx vitest run src/lib/demo/weaponStats.test.ts
 */

import assert from 'node:assert/strict';
import { persistWeaponStats, clearWeaponStats } from './weaponStats';
import { __setTestAdminClient } from '../supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '../test-support/fakeSupabase';
import type { DemoWeaponStat } from '../types';
import { test, report } from '../test-support/miniTest';

const MATCH_ID = 100;

function bucket(overrides: Partial<{ shots_fired: number; shots_hit: number; headshot_hits: number; damage_dealt: number; rounds_played: number }> = {}) {
  return { shots_fired: 0, shots_hit: 0, headshot_hits: 0, damage_dealt: 0, rounds_played: 0, ...overrides };
}

function baseDb(): FakeDb {
  return {
    player_match_stats: [{ id: 1000, match_id: MATCH_ID, player_id: 1 }],
    player_match_weapon_stats: [],
    player_match_economy_stats: [],
  };
}

async function main() {
  await test('persistWeaponStats: inserts one row per weapon/economy bucket, keyed to the resolved player_match_stats.id', async () => {
    const db = baseDb();
    __setTestAdminClient(createFakeSupabaseClient(db));
    const rows: DemoWeaponStat[] = [
      {
        player_id: 1,
        weaponStats: [
          { weapon: 'ak47', ...bucket({ shots_fired: 90, shots_hit: 40 }) },
          { weapon: 'glock', ...bucket({ shots_fired: 20, shots_hit: 8 }) },
        ],
        economyStats: [{ economy_type: 'full_buy', ...bucket({ shots_fired: 95, shots_hit: 42 }) }],
      },
    ];
    await persistWeaponStats(MATCH_ID, rows);
    assert.equal(db.player_match_weapon_stats!.length, 2);
    assert.equal(db.player_match_economy_stats!.length, 1);
    assert.ok(db.player_match_weapon_stats!.every((r) => r.player_match_stats_id === 1000));
  });

  await test('persistWeaponStats: a passed-in pmsById is used instead of resolving one (#518)', async () => {
    // No player_match_stats rows at all — proves the pre-resolved map is what resolves the player,
    // not a fresh query (matchScore.ts shares one map across all six sibling fact tables this way).
    const db: FakeDb = { player_match_weapon_stats: [], player_match_economy_stats: [] };
    __setTestAdminClient(createFakeSupabaseClient(db));
    const rows: DemoWeaponStat[] = [
      { player_id: 1, weaponStats: [{ weapon: 'ak47', ...bucket({ shots_fired: 10 }) }], economyStats: [] },
    ];
    await persistWeaponStats(MATCH_ID, rows, new Map([[1, 1000]]));
    assert.equal(db.player_match_weapon_stats!.length, 1);
    assert.equal(db.player_match_weapon_stats![0].player_match_stats_id, 1000);
  });

  await test('persistWeaponStats: a player with no player_match_stats row for this match is dropped entirely', async () => {
    const db = baseDb();
    __setTestAdminClient(createFakeSupabaseClient(db));
    const rows: DemoWeaponStat[] = [
      { player_id: 999, weaponStats: [{ weapon: 'ak47', ...bucket() }], economyStats: [] },
    ];
    await persistWeaponStats(MATCH_ID, rows);
    assert.equal(db.player_match_weapon_stats!.length, 0);
  });

  await test('persistWeaponStats: a reparse with a smaller bucket set drops the now-stale bucket (delete-then-insert)', async () => {
    const db = baseDb();
    db.player_match_weapon_stats = [
      { match_id: MATCH_ID, player_match_stats_id: 1000, weapon: 'ak47', ...bucket() },
      { match_id: MATCH_ID, player_match_stats_id: 1000, weapon: 'awp', ...bucket() }, // no awp shots this reparse
    ];
    __setTestAdminClient(createFakeSupabaseClient(db));
    const rows: DemoWeaponStat[] = [
      { player_id: 1, weaponStats: [{ weapon: 'ak47', ...bucket({ shots_fired: 10 }) }], economyStats: [] },
    ];
    await persistWeaponStats(MATCH_ID, rows);
    assert.equal(db.player_match_weapon_stats!.length, 1);
    assert.equal(db.player_match_weapon_stats![0].weapon, 'ak47');
  });

  await test('persistWeaponStats: every player unresolved leaves existing rows untouched (does not wipe them)', async () => {
    const db = baseDb();
    db.player_match_weapon_stats = [
      { match_id: MATCH_ID, player_match_stats_id: 1000, weapon: 'ak47', ...bucket({ shots_fired: 10 }) },
    ];
    __setTestAdminClient(createFakeSupabaseClient(db));
    const rows: DemoWeaponStat[] = [
      { player_id: 999, weaponStats: [{ weapon: 'ak47', ...bucket() }], economyStats: [] },
    ];
    await persistWeaponStats(MATCH_ID, rows);
    assert.equal(db.player_match_weapon_stats!.length, 1);
    assert.equal(db.player_match_weapon_stats![0].player_match_stats_id, 1000);
  });

  await test('persistWeaponStats: an empty input is a no-op', async () => {
    const db = baseDb();
    __setTestAdminClient(createFakeSupabaseClient(db));
    await persistWeaponStats(MATCH_ID, []);
    assert.equal(db.player_match_weapon_stats!.length, 0);
  });

  await test('clearWeaponStats: deletes weapon + economy rows for this match, leaving other matches untouched', async () => {
    const OTHER_MATCH_ID = 200;
    const db = baseDb();
    db.player_match_weapon_stats = [
      { match_id: MATCH_ID, player_match_stats_id: 1000, weapon: 'ak47', ...bucket() },
      { match_id: OTHER_MATCH_ID, player_match_stats_id: 2000, weapon: 'ak47', ...bucket() },
    ];
    db.player_match_economy_stats = [
      { match_id: MATCH_ID, player_match_stats_id: 1000, economy_type: 'full_buy', ...bucket() },
    ];
    __setTestAdminClient(createFakeSupabaseClient(db));
    await clearWeaponStats(MATCH_ID);
    assert.deepEqual(db.player_match_weapon_stats!.map((r) => r.player_match_stats_id), [2000]);
    assert.equal(db.player_match_economy_stats!.length, 0);
  });

  __setTestAdminClient(undefined);
  report();
}

await main();
