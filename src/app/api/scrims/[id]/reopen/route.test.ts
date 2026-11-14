/**
 * Route-handler tests for POST /api/scrims/[id]/reopen: only a night that is over, and still within
 * `SCRIM_NIGHT_SPAN_MS` of its start; only an admin or a player signed up for it; refused while
 * another night holds the server; and reopening clears `ended_at` and counts as activity.
 *
 * Run:  npx vitest run src/app/api/scrims/[id]/reopen/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb, type Row } from '@/lib/test-support/fakeSupabase';
import { sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { idleFor, scrimNightStartingIn } from '@/lib/test-support/scrimFixtures';
import { scrimNightRpcs } from '@/lib/test-support/scrimNightRpcs';
import { POST } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const OUTSIDER_ID = 3;
const NIGHT = '5';
const HOUR = 60 * 60 * 1000;

/** Night 5, started two hours ago and ended by hand an hour ago. */
const ended = (): Row => ({ ...scrimNightStartingIn(-2 * HOUR, Number(NIGHT)), ended_at: new Date(Date.now() - HOUR).toISOString() });

function installFixture(nights: Row[]): FakeDb {
  const db: FakeDb = {
    players: [
      { id: ADMIN_ID, name: 'Admin', is_admin: true },
      { id: PLAYER_ID, name: 'Player', is_admin: false },
      { id: OUTSIDER_ID, name: 'Outsider', is_admin: false },
    ],
    scrim_nights: nights,
    scrim_signups: [{ id: 1, night_id: 5, player_id: PLAYER_ID, commitment: 'definite', checked_in_at: null }],
    matches: [],
  };
  __setTestAdminClient(createFakeSupabaseClient(db, scrimNightRpcs));
  return db;
}

const reopen = (id = NIGHT) => POST(new Request(`http://localhost/api/scrims/${id}/reopen`, { method: 'POST' }), { params: Promise.resolve({ id }) });

async function main() {
  await test('a signed-up player reopens a night ended by hand: ended_at clears and now counts as activity', async () => {
    const db = installFixture([ended()]);
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await reopen()).status, 200);
    assert.equal(db.scrim_nights[0].ended_at, null);
    assert.ok(Date.now() - Date.parse(db.scrim_nights[0].last_active_at as string) < 60_000);
  });

  await test('an admin reopens a night gone idle without being signed up', async () => {
    installFixture([idleFor(scrimNightStartingIn(-3 * HOUR, Number(NIGHT)), 2 * HOUR)]);
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await reopen()).status, 200);
  });

  await test('401 signed out, 403 for a player not on the night', async () => {
    const db = installFixture([ended()]);
    __setTestSession(null);
    assert.equal((await reopen()).status, 401);
    __setTestSession(sessionFor(OUTSIDER_ID));
    assert.equal((await reopen()).status, 403);
    assert.ok(db.scrim_nights[0].ended_at);
  });

  await test('409 for a night still on, and one more than the span past its start', async () => {
    installFixture([scrimNightStartingIn(-HOUR, Number(NIGHT))]);
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await reopen()).status, 409);
    installFixture([{ ...ended(), starts_at: new Date(Date.now() - 13 * HOUR).toISOString() }]);
    assert.equal((await reopen()).status, 409);
  });

  await test('409 while another night is current on the server', async () => {
    const db = installFixture([ended(), scrimNightStartingIn(-10 * 60 * 1000, 6)]);
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await reopen()).status, 409);
    assert.ok(db.scrim_nights[0].ended_at);
  });

  await test('404 for a night that does not exist', async () => {
    installFixture([ended()]);
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await reopen('99')).status, 404);
  });

  report();
}

await main();

__setTestSession(undefined);
__setTestAdminClient(undefined);
