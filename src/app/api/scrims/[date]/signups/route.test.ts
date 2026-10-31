/**
 * Route-handler tests for POST/DELETE /api/scrims/[date]/signups: `requireScrimSignupAccess()`'s
 * admin-vs-self branches and night checks (unlisted, cancelled, malformed date), the first signup
 * creating the `scrim_nights` row, a repeat signup changing the commitment, and dropping out.
 *
 * Run:  npx vitest run src/app/api/scrims/[date]/signups/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { scrimNightSlots, type ScrimSchedule } from '@/lib/scrim-schedule';
import { POST, DELETE } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const OTHER_PLAYER_ID = 3;

const SCHEDULE: ScrimSchedule = { weekday: 4, startTime: '20:00', timezone: 'America/New_York', enabled: true };
/** The next two scheduled dates as of the real clock, which the route reads. */
const [NEXT, FOLLOWING] = scrimNightSlots(SCHEDULE, [], new Date(), 2).map((s) => s.date);

function installFixture(extra: Partial<FakeDb> = {}): FakeDb {
  const db: FakeDb = {
    players: [
      { id: ADMIN_ID, name: 'Admin', is_admin: true },
      { id: PLAYER_ID, name: 'Player', is_admin: false },
      { id: OTHER_PLAYER_ID, name: 'Other', is_admin: false },
    ],
    scrim_schedule: [{ id: 1, weekday: 4, start_time: '20:00:00', timezone: SCHEDULE.timezone, enabled: true }],
    scrim_nights: [],
    scrim_signups: [],
    ...extra,
  };
  __setTestAdminClient(createFakeSupabaseClient(db));
  return db;
}

function call(handler: typeof POST, method: 'POST' | 'DELETE', date: string, body: Record<string, unknown>) {
  return handler(jsonRequest(`http://localhost/api/scrims/${date}/signups`, method, body), {
    params: Promise.resolve({ date }),
  });
}

async function main() {
  await test('POST: 401 when signed out', async () => {
    installFixture();
    __setTestSession(null);
    const res = await call(POST, 'POST', NEXT, { player_id: PLAYER_ID, commitment: 'definite' });
    assert.equal(res.status, 401);
  });

  await test('POST: 400 for a malformed date, before any session read', async () => {
    installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    for (const date of ['2026-13-01', 'tomorrow', '2026-1-1']) {
      const res = await call(POST, 'POST', date, { player_id: PLAYER_ID, commitment: 'definite' });
      assert.equal(res.status, 400, date);
    }
  });

  await test('POST: a player can sign themselves up, creating the night row', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await call(POST, 'POST', NEXT, { player_id: PLAYER_ID, commitment: 'maybe' });
    assert.equal(res.status, 201);
    assert.equal(db.scrim_nights.length, 1);
    assert.equal(db.scrim_nights[0].night_date, NEXT);
    assert.deepEqual(
      db.scrim_signups.map((s) => [s.night_id, s.player_id, s.commitment]),
      [[db.scrim_nights[0].id, PLAYER_ID, 'maybe']],
    );
  });

  await test('POST: signing up again changes the commitment instead of adding a row', async () => {
    const db = installFixture({
      scrim_nights: [{ id: 5, night_date: NEXT, cancelled: false }],
      scrim_signups: [{ id: 1, night_id: 5, player_id: PLAYER_ID, commitment: 'maybe', signed_up_at: '2026-01-01T00:00:00Z' }],
    });
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await call(POST, 'POST', NEXT, { player_id: PLAYER_ID, commitment: 'definite' });
    assert.equal(res.status, 201);
    assert.equal(db.scrim_signups.length, 1);
    assert.equal(db.scrim_signups[0].commitment, 'definite');
    assert.equal(db.scrim_signups[0].signed_up_at, '2026-01-01T00:00:00Z');
  });

  await test('POST: 400 for a missing or unknown commitment', async () => {
    installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await call(POST, 'POST', NEXT, { player_id: PLAYER_ID })).status, 400);
    assert.equal((await call(POST, 'POST', NEXT, { player_id: PLAYER_ID, commitment: 'yes' })).status, 400);
  });

  await test('POST: 403 when a non-admin signs up someone else', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await call(POST, 'POST', NEXT, { player_id: OTHER_PLAYER_ID, commitment: 'definite' });
    assert.equal(res.status, 403);
    assert.equal(db.scrim_signups.length, 0);
  });

  await test('POST: an admin can sign up anyone, for any listed night', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const res = await call(POST, 'POST', FOLLOWING, { player_id: OTHER_PLAYER_ID, commitment: 'definite' });
    assert.equal(res.status, 201);
    assert.equal(db.scrim_signups[0].player_id, OTHER_PLAYER_ID);
  });

  await test('POST: 404 for a date that is not a scheduled night', async () => {
    installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await call(POST, 'POST', '2020-01-02', { player_id: PLAYER_ID, commitment: 'definite' });
    assert.equal(res.status, 404);
  });

  await test('POST: 404 with no schedule set', async () => {
    installFixture({ scrim_schedule: [] });
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await call(POST, 'POST', NEXT, { player_id: PLAYER_ID, commitment: 'definite' });
    assert.equal(res.status, 404);
  });

  await test('POST: 409 for a cancelled night', async () => {
    const db = installFixture({ scrim_nights: [{ id: 5, night_date: NEXT, cancelled: true }] });
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await call(POST, 'POST', NEXT, { player_id: PLAYER_ID, commitment: 'definite' });
    assert.equal(res.status, 409);
    assert.equal(db.scrim_signups.length, 0);
  });

  await test('POST: 404 when an admin names a player that does not exist, with no night row left behind', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const res = await call(POST, 'POST', NEXT, { player_id: 999, commitment: 'definite' });
    assert.equal(res.status, 404);
    assert.equal(db.scrim_nights.length, 0);
  });

  await test('DELETE: dropping out of a cancelled night is allowed', async () => {
    const db = installFixture({
      scrim_nights: [{ id: 5, night_date: NEXT, cancelled: true }],
      scrim_signups: [{ id: 1, night_id: 5, player_id: PLAYER_ID, commitment: 'definite' }],
    });
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await call(DELETE, 'DELETE', NEXT, { player_id: PLAYER_ID });
    assert.equal(res.status, 200);
    assert.equal(db.scrim_signups.length, 0);
  });

  await test('DELETE: a player can drop themselves, leaving others signed up', async () => {
    const db = installFixture({
      scrim_nights: [{ id: 5, night_date: NEXT, cancelled: false }],
      scrim_signups: [
        { id: 1, night_id: 5, player_id: PLAYER_ID, commitment: 'definite' },
        { id: 2, night_id: 5, player_id: OTHER_PLAYER_ID, commitment: 'maybe' },
      ],
    });
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await call(DELETE, 'DELETE', NEXT, { player_id: PLAYER_ID });
    assert.equal(res.status, 200);
    assert.deepEqual(db.scrim_signups.map((s) => s.player_id), [OTHER_PLAYER_ID]);
  });

  await test('DELETE: 403 when a non-admin drops someone else; an admin can', async () => {
    const db = installFixture({
      scrim_nights: [{ id: 5, night_date: NEXT, cancelled: false }],
      scrim_signups: [{ id: 2, night_id: 5, player_id: OTHER_PLAYER_ID, commitment: 'maybe' }],
    });
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await call(DELETE, 'DELETE', NEXT, { player_id: OTHER_PLAYER_ID })).status, 403);
    assert.equal(db.scrim_signups.length, 1);
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await call(DELETE, 'DELETE', NEXT, { player_id: OTHER_PLAYER_ID })).status, 200);
    assert.equal(db.scrim_signups.length, 0);
  });

  await test('DELETE: a night nobody has signed up for is a no-op success', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await call(DELETE, 'DELETE', NEXT, { player_id: PLAYER_ID });
    assert.equal(res.status, 200);
    assert.equal(db.scrim_nights.length, 0);
  });

  report();
}

await main();

__setTestSession(undefined);
__setTestAdminClient(undefined);
