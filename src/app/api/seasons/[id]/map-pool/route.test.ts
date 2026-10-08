/**
 * Route-handler harness for PATCH /api/seasons/[id]/map-pool — auth, the UPCOMING-only rule, and
 * the "empty or exactly 5 maps" validation, through the exported handler directly.
 *
 * Run:  npx vitest run src/app/api/seasons/[id]/map-pool/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { PATCH } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const UPCOMING_ID = 10;
const ACTIVE_ID = 11;
const GAUNTLET_ID = 12;
const FIVE = ['a', 'b', 'c', 'd', 'e'];

function installFixture(): FakeDb {
  const db: FakeDb = {
    players: [
      { id: ADMIN_ID, is_admin: true },
      { id: PLAYER_ID, is_admin: false },
    ],
    seasons: [
      { id: UPCOMING_ID, name: 'Season 1', status: 'UPCOMING', is_gauntlet: false, map_pool: null, target_win_rounds: 13 },
      { id: ACTIVE_ID, name: 'Season 2', status: 'ACTIVE', is_gauntlet: false, map_pool: FIVE, target_win_rounds: 13 },
      { id: GAUNTLET_ID, name: 'Season 3 Gauntlet', status: 'ACTIVE', is_gauntlet: true, map_pool: null, target_win_rounds: 13 },
    ],
    maps: [],
  };
  const client = createFakeSupabaseClient(db);
  __setTestAdminClient(client);
  return db;
}

function call(seasonId: number, sessionPlayerId: number | null, body: unknown) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return PATCH(jsonRequest(`http://localhost/api/seasons/${seasonId}/map-pool`, 'PATCH', body), {
    params: Promise.resolve({ id: String(seasonId) }),
  });
}

async function main() {
  await test('PATCH — unauthenticated (401) and non-admin (403) are rejected', async () => {
    installFixture();
    assert.equal((await call(UPCOMING_ID, null, { map_pool: FIVE })).status, 401);
    assert.equal((await call(UPCOMING_ID, PLAYER_ID, { map_pool: FIVE })).status, 403);
  });

  await test('PATCH — admin sets a 5-map pool on an UPCOMING season (200)', async () => {
    const db = installFixture();
    const res = await call(UPCOMING_ID, ADMIN_ID, { map_pool: FIVE });
    assert.equal(res.status, 200);
    assert.deepEqual(db.seasons.find((s) => s.id === UPCOMING_ID)!.map_pool, FIVE);
  });

  await test('PATCH — an empty pool clears it back to null (200)', async () => {
    const db = installFixture();
    db.seasons.find((s) => s.id === UPCOMING_ID)!.map_pool = FIVE;
    const res = await call(UPCOMING_ID, ADMIN_ID, { map_pool: [] });
    assert.equal(res.status, 200);
    assert.equal(db.seasons.find((s) => s.id === UPCOMING_ID)!.map_pool, null);
  });

  await test('PATCH — a pool that is neither empty nor 5 maps is rejected (400)', async () => {
    const db = installFixture();
    const res = await call(UPCOMING_ID, ADMIN_ID, { map_pool: FIVE.slice(0, 3) });
    assert.equal(res.status, 400);
    assert.equal(db.seasons.find((s) => s.id === UPCOMING_ID)!.map_pool, null);
  });

  await test('PATCH — duplicate names are collapsed, so a pool of repeats is rejected (400)', async () => {
    installFixture();
    assert.equal((await call(UPCOMING_ID, ADMIN_ID, { map_pool: ['a', 'A', 'a', 'a', 'a'] })).status, 400);
  });

  await test('PATCH — pool names are trimmed and lowercased', async () => {
    const db = installFixture();
    await call(UPCOMING_ID, ADMIN_ID, { map_pool: [' A', 'B', 'c', 'd', 'E '] });
    assert.deepEqual(db.seasons.find((s) => s.id === UPCOMING_ID)!.map_pool, FIVE);
  });

  await test('PATCH — a null new_maps entry is a 400, not a crash', async () => {
    installFixture();
    assert.equal((await call(UPCOMING_ID, ADMIN_ID, { map_pool: FIVE, new_maps: [null] })).status, 400);
  });

  await test('PATCH — a non-UPCOMING season is rejected (400)', async () => {
    installFixture();
    assert.equal((await call(ACTIVE_ID, ADMIN_ID, { map_pool: FIVE })).status, 400);
  });

  await test('PATCH — a gauntlet season is not found (404)', async () => {
    installFixture();
    assert.equal((await call(GAUNTLET_ID, ADMIN_ID, { map_pool: FIVE })).status, 404);
  });

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
