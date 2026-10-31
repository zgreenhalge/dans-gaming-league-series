/**
 * Route-handler tests for POST/DELETE /api/scrims/[date]/check-in: the check-in window, a walk-up
 * check-in creating a definite signup, a maybe becoming definite, checking out, and admin-or-self.
 *
 * Run:  npx vitest run src/app/api/scrims/[date]/check-in/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { POST, DELETE } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const OTHER_PLAYER_ID = 3;

/** A UTC weekly schedule whose next night starts `offsetMs` from the real clock (the route reads it). */
function scheduleStartingIn(offsetMs: number): { row: Record<string, unknown>; date: string } {
  const start = new Date(Date.now() + offsetMs);
  const hh = String(start.getUTCHours()).padStart(2, '0');
  const mm = String(start.getUTCMinutes()).padStart(2, '0');
  return {
    row: { id: 1, weekday: start.getUTCDay(), start_time: `${hh}:${mm}:00`, timezone: 'UTC', enabled: true },
    date: start.toISOString().slice(0, 10),
  };
}

function installFixture(offsetMs: number, extra: Partial<FakeDb> = {}): { db: FakeDb; date: string } {
  const { row, date } = scheduleStartingIn(offsetMs);
  const db: FakeDb = {
    players: [
      { id: ADMIN_ID, name: 'Admin', is_admin: true },
      { id: PLAYER_ID, name: 'Player', is_admin: false },
      { id: OTHER_PLAYER_ID, name: 'Other', is_admin: false },
    ],
    scrim_schedule: [row],
    scrim_nights: [],
    scrim_signups: [],
    ...extra,
  };
  __setTestAdminClient(createFakeSupabaseClient(db));
  return { db, date };
}

const SOON = 10 * 60 * 1000;
const LATER = 3 * 60 * 60 * 1000;

function call(handler: typeof POST, method: 'POST' | 'DELETE', date: string, body: Record<string, unknown>) {
  return handler(jsonRequest(`http://localhost/api/scrims/${date}/check-in`, method, body), { params: Promise.resolve({ date }) });
}

async function main() {
  await test('POST: 409 before check-in opens', async () => {
    const { db, date } = installFixture(LATER);
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await call(POST, 'POST', date, { player_id: PLAYER_ID })).status, 409);
    assert.equal(db.scrim_signups.length, 0);
  });

  await test('POST: a walk-up check-in creates a definite, checked-in signup', async () => {
    const { db, date } = installFixture(SOON);
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await call(POST, 'POST', date, { player_id: PLAYER_ID })).status, 200);
    assert.equal(db.scrim_signups.length, 1);
    assert.equal(db.scrim_signups[0].commitment, 'definite');
    assert.ok(db.scrim_signups[0].checked_in_at);
  });

  await test('POST: a maybe who checks in becomes definite', async () => {
    const { date } = scheduleStartingIn(SOON);
    const { db } = installFixture(SOON, {
      scrim_nights: [{ id: 5, night_date: date, cancelled: false }],
      scrim_signups: [{ id: 1, night_id: 5, player_id: PLAYER_ID, commitment: 'maybe', checked_in_at: null }],
    });
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await call(POST, 'POST', date, { player_id: PLAYER_ID })).status, 200);
    assert.equal(db.scrim_signups.length, 1);
    assert.equal(db.scrim_signups[0].commitment, 'definite');
  });

  await test('DELETE: checking out keeps the signup', async () => {
    const { date } = scheduleStartingIn(SOON);
    const { db } = installFixture(SOON, {
      scrim_nights: [{ id: 5, night_date: date, cancelled: false }],
      scrim_signups: [{ id: 1, night_id: 5, player_id: PLAYER_ID, commitment: 'definite', checked_in_at: '2026-01-01T00:00:00Z' }],
    });
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await call(DELETE, 'DELETE', date, { player_id: PLAYER_ID })).status, 200);
    assert.equal(db.scrim_signups.length, 1);
    assert.equal(db.scrim_signups[0].checked_in_at, null);
  });

  await test('POST: 403 for checking in someone else; an admin can', async () => {
    const { db, date } = installFixture(SOON);
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await call(POST, 'POST', date, { player_id: OTHER_PLAYER_ID })).status, 403);
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await call(POST, 'POST', date, { player_id: OTHER_PLAYER_ID })).status, 200);
    assert.equal(db.scrim_signups[0].player_id, OTHER_PLAYER_ID);
  });

  await test('POST: 409 for a cancelled night', async () => {
    const { date } = scheduleStartingIn(SOON);
    installFixture(SOON, { scrim_nights: [{ id: 5, night_date: date, cancelled: true }] });
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await call(POST, 'POST', date, { player_id: PLAYER_ID })).status, 409);
  });

  report();
}

await main();

__setTestSession(undefined);
__setTestAdminClient(undefined);
