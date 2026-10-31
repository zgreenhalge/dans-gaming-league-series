/**
 * Route-handler tests for the admin-only scrim routes: PATCH /api/scrims/[date] (cancel/restore a
 * night) and PUT /api/scrims/schedule (set the weekly slot).
 *
 * Run:  npx vitest run src/app/api/scrims/[date]/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { scrimNightSlots, type ScrimSchedule } from '@/lib/scrim-schedule';
import { PATCH } from './route';
import { PUT } from '../schedule/route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;

const SCHEDULE: ScrimSchedule = { weekday: 4, startTime: '20:00', timezone: 'America/New_York', enabled: true };
const [NEXT] = scrimNightSlots(SCHEDULE, [], new Date(), 1).map((s) => s.date);

function installFixture(extra: Partial<FakeDb> = {}): FakeDb {
  const db: FakeDb = {
    players: [
      { id: ADMIN_ID, name: 'Admin', is_admin: true },
      { id: PLAYER_ID, name: 'Player', is_admin: false },
    ],
    scrim_schedule: [{ id: 1, weekday: 4, start_time: '20:00:00', timezone: SCHEDULE.timezone, enabled: true }],
    scrim_nights: [],
    scrim_signups: [],
    ...extra,
  };
  __setTestAdminClient(createFakeSupabaseClient(db));
  return db;
}

const patch = (date: string, body: unknown) =>
  PATCH(jsonRequest(`http://localhost/api/scrims/${date}`, 'PATCH', body), { params: Promise.resolve({ date }) });
const put = (body: unknown) => PUT(jsonRequest('http://localhost/api/scrims/schedule', 'PUT', body));

async function main() {
  await test('PATCH: 403 for a non-admin', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await patch(NEXT, { cancelled: true })).status, 403);
    assert.equal(db.scrim_nights.length, 0);
  });

  await test('PATCH: cancelling a night with no row creates one, cancelled', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await patch(NEXT, { cancelled: true })).status, 200);
    assert.deepEqual(db.scrim_nights.map((n) => [n.night_date, n.cancelled]), [[NEXT, true]]);
  });

  await test('PATCH: restoring keeps the night row and its signups', async () => {
    const db = installFixture({
      scrim_nights: [{ id: 5, night_date: NEXT, cancelled: true }],
      scrim_signups: [{ id: 1, night_id: 5, player_id: PLAYER_ID, commitment: 'definite' }],
    });
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await patch(NEXT, { cancelled: false })).status, 200);
    assert.deepEqual(db.scrim_nights.map((n) => [n.id, n.cancelled]), [[5, false]]);
    assert.equal(db.scrim_signups.length, 1);
  });

  await test('PATCH: 400 for a malformed date or body, 404 for an unlisted date', async () => {
    installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await patch('not-a-date', { cancelled: true })).status, 400);
    assert.equal((await patch(NEXT, { cancelled: 'yes' })).status, 400);
    assert.equal((await patch('2020-01-02', { cancelled: true })).status, 404);
  });

  await test('PUT schedule: 403 for a non-admin', async () => {
    installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await put({ weekday: 5, startTime: '21:30', timezone: 'UTC', enabled: true })).status, 403);
  });

  await test('PUT schedule: an admin replaces the singleton row', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await put({ weekday: 5, startTime: '21:30', timezone: 'UTC', enabled: false })).status, 200);
    assert.deepEqual(db.scrim_schedule, [{ id: 1, weekday: 5, start_time: '21:30', timezone: 'UTC', enabled: false }]);
  });

  await test('PUT schedule: creates the row when none exists', async () => {
    const db = installFixture({ scrim_schedule: [] });
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await put({ weekday: 0, startTime: '19:00', timezone: 'Europe/London', enabled: true })).status, 200);
    assert.equal(db.scrim_schedule.length, 1);
  });

  await test('PUT schedule: 400 for an invalid body', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await put({ weekday: 9, startTime: '21:30', timezone: 'UTC', enabled: true })).status, 400);
    assert.equal(db.scrim_schedule[0].weekday, 4);
  });

  report();
}

await main();

__setTestSession(undefined);
__setTestAdminClient(undefined);
