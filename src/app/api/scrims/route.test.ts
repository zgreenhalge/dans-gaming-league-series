/**
 * Route-handler tests for POST /api/scrims: starting a night with its first signup, admin-or-self,
 * input checks (start time, commitment, player), and refusing a night within the night length of
 * another.
 *
 * Run:  npx vitest run src/app/api/scrims/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, FakeRpcError, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { scrimNightStartingIn } from '@/lib/test-support/scrimFixtures';
import { scrimNightRpcs } from '@/lib/test-support/scrimNightRpcs';
import { POST } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const OTHER_PLAYER_ID = 3;
const HOUR = 60 * 60 * 1000;
/** `h` hours from now, rounded down to the quarter hour a night must start on. */
const inHours = (h: number) => {
  const quarter = 15 * 60 * 1000;
  return new Date(Math.floor((Date.now() + h * HOUR) / quarter) * quarter).toISOString();
};

function installFixture(extra: Partial<FakeDb> = {}): FakeDb {
  const db: FakeDb = {
    players: [
      { id: ADMIN_ID, name: 'Admin', is_admin: true },
      { id: PLAYER_ID, name: 'Player', is_admin: false },
      { id: OTHER_PLAYER_ID, name: 'Other', is_admin: false },
    ],
    scrim_nights: [],
    scrim_signups: [],
    ...extra,
  };
  __setTestAdminClient(createFakeSupabaseClient(db, scrimNightRpcs));
  return db;
}

const start = (body: Record<string, unknown>) => POST(jsonRequest('http://localhost/api/scrims', 'POST', body));

async function main() {
  await test('a player starts a night as its first signup', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    const startsAt = inHours(48);
    const res = await start({ player_id: PLAYER_ID, startsAt, commitment: 'maybe' });
    assert.equal(res.status, 201);
    const { nightId } = (await res.json()) as { nightId: number };
    assert.deepEqual(db.scrim_nights, [{ id: nightId, starts_at: startsAt, ended_at: null }]);
    assert.deepEqual(db.scrim_signups.map((s) => [s.night_id, s.player_id, s.commitment]), [[nightId, PLAYER_ID, 'maybe']]);
  });

  await test('401 signed out; 403 starting one for someone else; an admin can', async () => {
    installFixture();
    __setTestSession(null);
    assert.equal((await start({ player_id: PLAYER_ID, startsAt: inHours(48), commitment: 'definite' })).status, 401);
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await start({ player_id: OTHER_PLAYER_ID, startsAt: inHours(48), commitment: 'definite' })).status, 403);
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await start({ player_id: OTHER_PLAYER_ID, startsAt: inHours(48), commitment: 'definite' })).status, 201);
  });

  await test('400 for a bad start, one off the quarter hour, a night already over, or a bad commitment; 404 for an unknown player', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await start({ player_id: PLAYER_ID, startsAt: 'soon', commitment: 'definite' })).status, 400);
    assert.equal((await start({ player_id: PLAYER_ID, startsAt: inHours(-5), commitment: 'definite' })).status, 400);
    const offTheMark = new Date(Date.parse(inHours(48)) + 7 * 60 * 1000).toISOString();
    assert.equal((await start({ player_id: PLAYER_ID, startsAt: offTheMark, commitment: 'definite' })).status, 400);
    assert.equal((await start({ player_id: PLAYER_ID, startsAt: inHours(48), commitment: 'yes' })).status, 400);
    assert.equal((await start({ player_id: 999, startsAt: inHours(48), commitment: 'definite' })).status, 404);
    assert.equal(db.scrim_nights.length, 0);
  });

  await test('a night already running can be started (one that began within the night length)', async () => {
    installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await start({ player_id: PLAYER_ID, startsAt: inHours(-1), commitment: 'definite' })).status, 201);
  });

  await test('409 overlapping another night; fine just outside it', async () => {
    const db = installFixture({ scrim_nights: [scrimNightStartingIn(48 * HOUR)] });
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await start({ player_id: PLAYER_ID, startsAt: inHours(50), commitment: 'definite' })).status, 409);
    assert.equal((await start({ player_id: PLAYER_ID, startsAt: inHours(45), commitment: 'definite' })).status, 409);
    assert.equal((await start({ player_id: PLAYER_ID, startsAt: inHours(53), commitment: 'definite' })).status, 201);
    assert.equal(db.scrim_nights.length, 2);
  });

  await test('an ended night frees its slot: a night can start after its end', async () => {
    const ended = { ...scrimNightStartingIn(-3 * HOUR), ended_at: new Date(Date.now() - HOUR).toISOString() };
    const db = installFixture({ scrim_nights: [ended] });
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await start({ player_id: PLAYER_ID, startsAt: inHours(0), commitment: 'definite' })).status, 201);
    assert.equal(db.scrim_nights.length, 2);
  });

  await test('409 starting before a still-running night ends, even one set to end later', async () => {
    const running = { ...scrimNightStartingIn(-3 * HOUR), ended_at: new Date(Date.now() + HOUR).toISOString() };
    installFixture({ scrim_nights: [running] });
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await start({ player_id: PLAYER_ID, startsAt: inHours(0), commitment: 'definite' })).status, 409);
  });

  await test('500 carrying the database message when the start fails for any other reason', async () => {
    const db = installFixture();
    __setTestAdminClient(
      createFakeSupabaseClient(db, {
        start_scrim_night: () => {
          throw new FakeRpcError('insert or update on table "scrim_signups" violates foreign key constraint');
        },
      }),
    );
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await start({ player_id: PLAYER_ID, startsAt: inHours(48), commitment: 'definite' });
    assert.equal(res.status, 500);
    assert.match(((await res.json()) as { error: string }).error, /violates foreign key constraint/);
  });

  report();
}

await main();

__setTestSession(undefined);
__setTestAdminClient(undefined);
