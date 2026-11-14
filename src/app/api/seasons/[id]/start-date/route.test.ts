/**
 * Route-handler harness for PATCH /api/seasons/[id]/start-date — auth, the id and date validation, and
 * setting and clearing the date, through the exported handler directly.
 *
 * Run:  npx vitest run "src/app/api/seasons/[id]/start-date/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { clientFailingOn, createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { MALFORMED_ROUTE_IDS, jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { PATCH } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const SEASON_ID = 10;
const OTHER_SEASON_ID = 11;

function installFixture(failUpdate = false): FakeDb {
  const db: FakeDb = {
    players: [
      { id: ADMIN_ID, is_admin: true },
      { id: PLAYER_ID, is_admin: false },
    ],
    seasons: [
      { id: SEASON_ID, name: 'Season 1', status: 'UPCOMING', is_gauntlet: false, start_date: '2026-11-01' },
      { id: OTHER_SEASON_ID, name: 'Season 2', status: 'UPCOMING', is_gauntlet: false, start_date: '2026-12-01' },
    ],
  };
  const client = createFakeSupabaseClient(db);
  __setTestAdminClient(failUpdate ? clientFailingOn(client, 'seasons', 'update', { code: 'TEST', message: 'connection reset' }) : client);
  return db;
}

function call(id: string | number, sessionPlayerId: number | null, body: unknown) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return PATCH(jsonRequest(`http://localhost/api/seasons/${id}/start-date`, 'PATCH', body), {
    params: Promise.resolve({ id: String(id) }),
  });
}

const startDateOf = (db: FakeDb, id: number) => db.seasons.find((s) => s.id === id)!.start_date;

async function main() {
  await test('PATCH — unauthenticated (401) and non-admin (403) are rejected and change nothing', async () => {
    const db = installFixture();
    assert.equal((await call(SEASON_ID, null, { start_date: '2027-01-01' })).status, 401);
    assert.equal((await call(SEASON_ID, PLAYER_ID, { start_date: '2027-01-01' })).status, 403);
    assert.equal(startDateOf(db, SEASON_ID), '2026-11-01');
  });

  await test('PATCH — a malformed season id is a 400', async () => {
    installFixture();
    for (const bad of MALFORMED_ROUTE_IDS) assert.equal((await call(bad, ADMIN_ID, { start_date: '2027-01-01' })).status, 400, bad);
  });

  await test('PATCH — a missing start_date, or a date not in YYYY-MM-DD form, is a 400 and changes nothing', async () => {
    const db = installFixture();
    for (const body of [null, {}, { other: 1 }, { start_date: '01/02/2027' }, { start_date: '2027-1-2' }, { start_date: '2027-01-02T00:00:00Z' }, { start_date: '2027-02-31' }, { start_date: ['2027-01-02'] }, { start_date: 20270102 }]) {
      assert.equal((await call(SEASON_ID, ADMIN_ID, body)).status, 400, JSON.stringify(body));
    }
    assert.equal(startDateOf(db, SEASON_ID), '2026-11-01');
  });

  await test('PATCH — an admin sets the season’s start date, and only that season’s (200)', async () => {
    const db = installFixture();
    assert.equal((await call(SEASON_ID, ADMIN_ID, { start_date: '2027-01-02' })).status, 200);
    assert.equal(startDateOf(db, SEASON_ID), '2027-01-02');
    assert.equal(startDateOf(db, OTHER_SEASON_ID), '2026-12-01');
  });

  await test('PATCH — a season that does not exist is a 404 and changes no other season', async () => {
    const db = installFixture();
    const res = await call(999, ADMIN_ID, { start_date: '2027-01-02' });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'Season not found');
    assert.equal(startDateOf(db, SEASON_ID), '2026-11-01');
    assert.equal(startDateOf(db, OTHER_SEASON_ID), '2026-12-01');
  });

  await test('PATCH — a null start_date clears it back to TBD (200)', async () => {
    const db = installFixture();
    assert.equal((await call(SEASON_ID, ADMIN_ID, { start_date: null })).status, 200);
    assert.equal(startDateOf(db, SEASON_ID), null);
  });

  await test('PATCH — a failed write is a 500 with its message, and the date is unchanged', async () => {
    const db = installFixture(true);
    const res = await call(SEASON_ID, ADMIN_ID, { start_date: '2027-01-02' });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, 'connection reset');
    assert.equal(startDateOf(db, SEASON_ID), '2026-11-01');
  });

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
