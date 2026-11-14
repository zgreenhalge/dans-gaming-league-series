/**
 * Route-handler tests for POST /api/scrims/[id]/end: only a started, current night; only an admin or a
 * player signed up for it; refused while a match still needs the server; and ending it stamps
 * `ended_at` once.
 *
 * Run:  npx vitest run src/app/api/scrims/[id]/end/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { idleFor, scrimNightStartingIn } from '@/lib/test-support/scrimFixtures';
import { POST } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const OUTSIDER_ID = 3;
const NIGHT = '5';

const RUNNING = -60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function installFixture(offsetMs: number, extra: Partial<FakeDb> = {}, idleMs = 0): FakeDb {
  const db: FakeDb = {
    players: [
      { id: ADMIN_ID, name: 'Admin', is_admin: true },
      { id: PLAYER_ID, name: 'Player', is_admin: false },
      { id: OUTSIDER_ID, name: 'Outsider', is_admin: false },
    ],
    scrim_nights: [idleFor(scrimNightStartingIn(offsetMs, Number(NIGHT)), idleMs)],
    scrim_signups: [{ id: 1, night_id: 5, player_id: PLAYER_ID, commitment: 'definite', checked_in_at: null }],
    matches: [],
    ...extra,
  };
  __setTestAdminClient(createFakeSupabaseClient(db));
  return db;
}

const end = (id = NIGHT) => POST(new Request(`http://localhost/api/scrims/${id}/end`, { method: 'POST' }), { params: Promise.resolve({ id }) });

async function main() {
  await test('a signed-up player ends a running night', async () => {
    const db = installFixture(RUNNING);
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await end()).status, 200);
    assert.ok(db.scrim_nights[0].ended_at);
  });

  await test('an admin can end it without being signed up', async () => {
    const db = installFixture(RUNNING);
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await end()).status, 200);
    assert.ok(db.scrim_nights[0].ended_at);
  });

  await test('401 signed out, 403 for a player not on the night', async () => {
    const db = installFixture(RUNNING);
    __setTestSession(null);
    assert.equal((await end()).status, 401);
    __setTestSession(sessionFor(OUTSIDER_ID));
    assert.equal((await end()).status, 403);
    assert.equal(db.scrim_nights[0].ended_at ?? null, null);
  });

  await test('409 before the night starts, and once it is over', async () => {
    installFixture(HOUR);
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await end()).status, 409);
    installFixture(-5 * HOUR, {}, 2 * HOUR);
    assert.equal((await end()).status, 409, 'gone idle');
  });

  await test('409 while a match is still waiting for the server; fine once it is scored', async () => {
    const db = installFixture(RUNNING, { matches: [{ id: 9, scrim_night_id: 5, match_number: 1, final_score: null }] });
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await end()).status, 409);
    assert.equal(db.scrim_nights[0].ended_at ?? null, null);
    db.matches[0].final_score = '13-7';
    assert.equal((await end()).status, 200);
  });

  await test('404 for a night that does not exist', async () => {
    installFixture(RUNNING);
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await end('99')).status, 404);
  });

  report();
}

await main();

__setTestSession(undefined);
__setTestAdminClient(undefined);
