/**
 * Route-handler tests for POST/DELETE /api/scrims/[id]/signups: `requireScrimSignupAccess()`'s
 * admin-vs-self branches and night checks (malformed id, no such night, ended), a repeat signup
 * changing the commitment, and dropping out — the last player out removing the night unless it has
 * matches.
 *
 * Run:  npx vitest run src/app/api/scrims/[id]/signups/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { scrimNightStartingIn } from '@/lib/test-support/scrimFixtures';
import { scrimNightRpcs } from '@/lib/test-support/scrimNightRpcs';
import { POST, DELETE } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const OTHER_PLAYER_ID = 3;
const NIGHT_ID = 5;
const DAY = 24 * 60 * 60 * 1000;

function installFixture(extra: Partial<FakeDb> = {}): FakeDb {
  const db: FakeDb = {
    players: [
      { id: ADMIN_ID, name: 'Admin', is_admin: true },
      { id: PLAYER_ID, name: 'Player', is_admin: false },
      { id: OTHER_PLAYER_ID, name: 'Other', is_admin: false },
    ],
    scrim_nights: [scrimNightStartingIn(2 * DAY, NIGHT_ID)],
    scrim_signups: [],
    matches: [],
    ...extra,
  };
  __setTestAdminClient(createFakeSupabaseClient(db, scrimNightRpcs));
  return db;
}

function call(handler: typeof POST, method: 'POST' | 'DELETE', id: string | number, body: Record<string, unknown>) {
  return handler(jsonRequest(`http://localhost/api/scrims/${id}/signups`, method, body), {
    params: Promise.resolve({ id: String(id) }),
  });
}

const signup = (id: number, playerId: number, commitment = 'definite') => ({
  id, night_id: NIGHT_ID, player_id: playerId, commitment, signed_up_at: '2026-01-01T00:00:00Z', checked_in_at: null,
});

async function main() {
  await test('POST: 401 when signed out', async () => {
    installFixture();
    __setTestSession(null);
    assert.equal((await call(POST, 'POST', NIGHT_ID, { player_id: PLAYER_ID, commitment: 'definite' })).status, 401);
  });

  await test('POST: 400 for a malformed id, 404 for no such night, 409 for one that is over', async () => {
    installFixture({ scrim_nights: [scrimNightStartingIn(-DAY, NIGHT_ID)] });
    __setTestSession(sessionFor(PLAYER_ID));
    const body = { player_id: PLAYER_ID, commitment: 'definite' };
    assert.equal((await call(POST, 'POST', 'tomorrow', body)).status, 400);
    assert.equal((await call(POST, 'POST', 99, body)).status, 404);
    assert.equal((await call(POST, 'POST', NIGHT_ID, body)).status, 409);
  });

  await test('POST: a player signs themselves up; again changes the commitment and keeps signed_up_at', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await call(POST, 'POST', NIGHT_ID, { player_id: PLAYER_ID, commitment: 'maybe' })).status, 201);
    assert.deepEqual(db.scrim_signups.map((s) => [s.night_id, s.player_id, s.commitment]), [[NIGHT_ID, PLAYER_ID, 'maybe']]);
    const signedUpAt = db.scrim_signups[0].signed_up_at;
    assert.equal((await call(POST, 'POST', NIGHT_ID, { player_id: PLAYER_ID, commitment: 'definite' })).status, 201);
    assert.equal(db.scrim_signups.length, 1);
    assert.equal(db.scrim_signups[0].commitment, 'definite');
    assert.equal(db.scrim_signups[0].signed_up_at, signedUpAt);
  });

  await test('POST: 400 for a missing or unknown commitment', async () => {
    installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await call(POST, 'POST', NIGHT_ID, { player_id: PLAYER_ID })).status, 400);
    assert.equal((await call(POST, 'POST', NIGHT_ID, { player_id: PLAYER_ID, commitment: 'yes' })).status, 400);
  });

  await test('POST: 403 when a non-admin signs up someone else; an admin can; 404 for an unknown player', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await call(POST, 'POST', NIGHT_ID, { player_id: OTHER_PLAYER_ID, commitment: 'definite' })).status, 403);
    assert.equal(db.scrim_signups.length, 0);
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await call(POST, 'POST', NIGHT_ID, { player_id: OTHER_PLAYER_ID, commitment: 'definite' })).status, 201);
    assert.equal((await call(POST, 'POST', NIGHT_ID, { player_id: 999, commitment: 'definite' })).status, 404);
    assert.deepEqual(db.scrim_signups.map((s) => s.player_id), [OTHER_PLAYER_ID]);
  });

  await test('DELETE: a player drops themselves, leaving the night for the others', async () => {
    const db = installFixture({ scrim_signups: [signup(1, PLAYER_ID), signup(2, OTHER_PLAYER_ID, 'maybe')] });
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await call(DELETE, 'DELETE', NIGHT_ID, { player_id: PLAYER_ID });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { nightRemoved: boolean }).nightRemoved, false);
    assert.deepEqual(db.scrim_signups.map((s) => s.player_id), [OTHER_PLAYER_ID]);
    assert.equal(db.scrim_nights.length, 1);
  });

  await test('DELETE: the last player out removes the night', async () => {
    const db = installFixture({ scrim_signups: [signup(1, PLAYER_ID)] });
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await call(DELETE, 'DELETE', NIGHT_ID, { player_id: PLAYER_ID });
    assert.equal(((await res.json()) as { nightRemoved: boolean }).nightRemoved, true);
    assert.equal(db.scrim_nights.length, 0);
  });

  await test('DELETE: a night with matches stays when its last player drops out', async () => {
    const db = installFixture({
      scrim_signups: [signup(1, PLAYER_ID)],
      matches: [{ id: 900, week_id: null, scrim_night_id: NIGHT_ID, match_number: 1, final_score: '13-7' }],
    });
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await call(DELETE, 'DELETE', NIGHT_ID, { player_id: PLAYER_ID });
    assert.equal(((await res.json()) as { nightRemoved: boolean }).nightRemoved, false);
    assert.equal(db.scrim_nights.length, 1);
  });

  await test('DELETE: 403 when a non-admin drops someone else; an admin can', async () => {
    const db = installFixture({ scrim_signups: [signup(1, PLAYER_ID), signup(2, OTHER_PLAYER_ID, 'maybe')] });
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await call(DELETE, 'DELETE', NIGHT_ID, { player_id: OTHER_PLAYER_ID })).status, 403);
    assert.equal(db.scrim_signups.length, 2);
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await call(DELETE, 'DELETE', NIGHT_ID, { player_id: OTHER_PLAYER_ID })).status, 200);
    assert.deepEqual(db.scrim_signups.map((s) => s.player_id), [PLAYER_ID]);
  });

  report();
}

await main();

__setTestSession(undefined);
__setTestAdminClient(undefined);
