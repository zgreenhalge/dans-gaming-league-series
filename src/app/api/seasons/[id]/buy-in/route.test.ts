/**
 * Route-handler harness for PATCH /api/seasons/[id]/buy-in — auth, id and amount validation, and
 * each refusal `set_season_buy_in()` reports, through the exported handler directly.
 *
 * Run:  npx vitest run "src/app/api/seasons/[id]/buy-in/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { seasonBuyInRpcs } from '@/lib/test-support/seasonBuyInRpc';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { PATCH } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const UPCOMING_ID = 10;
const ACTIVE_ID = 11;
const GAUNTLET_ID = 12;
const DRAFTED_ID = 13;
const CONFIRMED_ID = 14;

function installFixture(): FakeDb {
  const db: FakeDb = {
    players: [
      { id: ADMIN_ID, is_admin: true },
      { id: PLAYER_ID, is_admin: false },
    ],
    seasons: [
      { id: UPCOMING_ID, name: 'Season 1', status: 'UPCOMING', is_gauntlet: false, buy_in_amount: 10 },
      { id: ACTIVE_ID, name: 'Season 2', status: 'ACTIVE', is_gauntlet: false, buy_in_amount: 10 },
      { id: GAUNTLET_ID, name: 'Season 2 Gauntlet', status: 'UPCOMING', is_gauntlet: true, buy_in_amount: null },
      { id: DRAFTED_ID, name: 'Season 3', status: 'UPCOMING', is_gauntlet: false, buy_in_amount: 10 },
      { id: CONFIRMED_ID, name: 'Season 4', status: 'UPCOMING', is_gauntlet: false, buy_in_amount: 10 },
    ],
    season_schedule_draft_weeks: [{ id: 1, season_id: DRAFTED_ID, week_number: 1, bye_player_id: null }],
    weeks: [{ id: 1, season_id: CONFIRMED_ID, week_number: 1 }],
  };
  const client = createFakeSupabaseClient(db, seasonBuyInRpcs);
  __setTestAdminClient(client);
  return db;
}

function call(id: string | number, sessionPlayerId: number | null, body: unknown) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return PATCH(jsonRequest(`http://localhost/api/seasons/${id}/buy-in`, 'PATCH', body), {
    params: Promise.resolve({ id: String(id) }),
  });
}

const buyInOf = (db: FakeDb, id: number) => db.seasons.find((s) => s.id === id)!.buy_in_amount;

async function main() {
  await test('PATCH — unauthenticated (401) and non-admin (403) are rejected', async () => {
    installFixture();
    assert.equal((await call(UPCOMING_ID, null, { buy_in_amount: 5 })).status, 401);
    assert.equal((await call(UPCOMING_ID, PLAYER_ID, { buy_in_amount: 5 })).status, 403);
  });

  await test('PATCH — admin sets an UPCOMING season’s buy-in (200)', async () => {
    const db = installFixture();
    assert.equal((await call(UPCOMING_ID, ADMIN_ID, { buy_in_amount: 7.5 })).status, 200);
    assert.equal(buyInOf(db, UPCOMING_ID), 7.5);
  });

  await test('PATCH — a malformed season id is a 400', async () => {
    installFixture();
    assert.equal((await call('abc', ADMIN_ID, { buy_in_amount: 5 })).status, 400);
    assert.equal((await call('1.5', ADMIN_ID, { buy_in_amount: 5 })).status, 400);
  });

  await test('PATCH — a missing, negative or over-precise amount is a 400 and writes nothing', async () => {
    const db = installFixture();
    for (const body of [{}, { buy_in_amount: -1 }, { buy_in_amount: 1.234 }, { buy_in_amount: '5' }]) {
      assert.equal((await call(UPCOMING_ID, ADMIN_ID, body)).status, 400);
    }
    assert.equal(buyInOf(db, UPCOMING_ID), 10);
  });

  await test('PATCH — a non-UPCOMING season is a 400, a gauntlet or missing season a 404', async () => {
    installFixture();
    assert.equal((await call(ACTIVE_ID, ADMIN_ID, { buy_in_amount: 5 })).status, 400);
    assert.equal((await call(GAUNTLET_ID, ADMIN_ID, { buy_in_amount: 5 })).status, 404);
    assert.equal((await call(999, ADMIN_ID, { buy_in_amount: 5 })).status, 404);
  });

  await test('PATCH — a drafted or confirmed schedule locks the buy-in (409)', async () => {
    const db = installFixture();
    assert.equal((await call(DRAFTED_ID, ADMIN_ID, { buy_in_amount: 5 })).status, 409);
    assert.equal((await call(CONFIRMED_ID, ADMIN_ID, { buy_in_amount: 5 })).status, 409);
    assert.equal(buyInOf(db, DRAFTED_ID), 10);
    assert.equal(buyInOf(db, CONFIRMED_ID), 10);
  });

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
