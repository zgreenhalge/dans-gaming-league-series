/**
 * Route-handler harness for POST /api/seasons — season creation's buy-in handling, through the
 * exported handler directly.
 *
 * Run:  npx vitest run src/app/api/seasons/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestClient } from '@/lib/supabase';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { POST } from './route';

const ADMIN_ID = 1;
const NEW_SEASON_NAME = 'Season 2 Regular Season';

function installFixture(): FakeDb {
  const db: FakeDb = {
    players: [{ id: ADMIN_ID, is_admin: true }],
    seasons: [{ id: 1, name: 'Season 1 Regular Season', status: 'ARCHIVED', is_gauntlet: false }],
    maps: [],
  };
  const client = createFakeSupabaseClient(db);
  __setTestClient(client);
  __setTestAdminClient(client);
  return db;
}

function call(body: unknown) {
  __setTestSession(sessionFor(ADMIN_ID));
  return POST(jsonRequest('http://localhost/api/seasons', 'POST', body));
}

const created = (db: FakeDb) => db.seasons.find((s) => s.name === NEW_SEASON_NAME);

async function main() {
  await test('POST — an omitted buy-in creates the season with a TBD (null) buy-in (201)', async () => {
    const db = installFixture();
    assert.equal((await call({ map_pool: [] })).status, 201);
    assert.equal(created(db)?.buy_in_amount, null);
  });

  await test('POST — a given buy-in is stored (201)', async () => {
    const db = installFixture();
    assert.equal((await call({ map_pool: [], buy_in_amount: 7.5 })).status, 201);
    assert.equal(created(db)?.buy_in_amount, 7.5);
  });

  await test('POST — an invalid buy-in is a 400 and creates nothing', async () => {
    const db = installFixture();
    assert.equal((await call({ map_pool: [], buy_in_amount: -5 })).status, 400);
    assert.equal(created(db), undefined);
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
