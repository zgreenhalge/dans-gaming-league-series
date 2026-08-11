/**
 * Route-handler harness for POST/DELETE /api/seasons/[id]/players — the first `route.ts` covered
 * by dedicated tests (#319). Exercises `requireSeasonRosterAccess()`'s admin-vs-self branches and
 * its `UPCOMING`-only status gate directly through the exported handlers, using:
 *  - `jsonRequest()` (test-support/nextRequest.ts) to build a real `NextRequest`
 *  - `__setTestSession()` (lib/session.ts) to stand in for `getServerSession()`
 *  - `__setTestClient()` / `__setTestAdminClient()` with a fake Supabase client
 *    (test-support/fakeSupabase.ts) backing both the anon client (`isPlayerAdmin()` reads through
 *    it) and the admin client (everything else in the route reads/writes through it)
 *
 * Run:  npx tsx src/app/api/seasons/[id]/players/route.test.ts
 */

import assert from 'node:assert/strict';
import type { Session } from 'next-auth';
import { __setTestSession } from '@/lib/session';
import { __setTestClient } from '@/lib/supabase';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb, type Row } from '@/lib/test-support/fakeSupabase';
import { jsonRequest } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { POST, DELETE } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const OTHER_PLAYER_ID = 3;
const UPCOMING_SEASON_ID = 10;
const ACTIVE_SEASON_ID = 20;

function makeDb(): FakeDb {
  return {
    players: [
      { id: ADMIN_ID, is_admin: true },
      { id: PLAYER_ID, is_admin: false },
      { id: OTHER_PLAYER_ID, is_admin: false },
    ],
    seasons: [
      { id: UPCOMING_SEASON_ID, status: 'UPCOMING' },
      { id: ACTIVE_SEASON_ID, status: 'ACTIVE' },
    ],
    season_players: [{ season_id: UPCOMING_SEASON_ID, player_id: PLAYER_ID }],
  };
}

/** Fresh fixture per test, wired as both the anon client (`isPlayerAdmin()`) and admin client
 * (everything else `requireSeasonRosterAccess()`/the route touches) so a mutation in one is visible
 * to the other, matching how both point at the same database in production. */
function installFixture(): FakeDb {
  const db = makeDb();
  const client = createFakeSupabaseClient(db);
  __setTestClient(client);
  __setTestAdminClient(client);
  return db;
}

function sessionFor(playerId: number): Session {
  return { user: { playerId }, expires: '2099-01-01T00:00:00.000Z' };
}

function seasonPlayersOf(db: FakeDb, seasonId: number): Row[] {
  return db.season_players.filter((r) => r.season_id === seasonId);
}

const url = (seasonId: number | string) => `http://localhost/api/seasons/${seasonId}/players`;

async function main() {
  await test('POST — unauthenticated request is rejected (401)', async () => {
    installFixture();
    __setTestSession(null);
    const res = await POST(jsonRequest(url(UPCOMING_SEASON_ID), 'POST', { player_id: PLAYER_ID }), {
      params: Promise.resolve({ id: String(UPCOMING_SEASON_ID) }),
    });
    assert.equal(res.status, 401);
  });

  await test('POST — non-numeric season id is rejected (400)', async () => {
    installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const res = await POST(jsonRequest(url('abc'), 'POST', { player_id: PLAYER_ID }), {
      params: Promise.resolve({ id: 'abc' }),
    });
    assert.equal(res.status, 400);
  });

  await test('POST — unknown season id is rejected (404)', async () => {
    installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const res = await POST(jsonRequest(url(999), 'POST', { player_id: PLAYER_ID }), {
      params: Promise.resolve({ id: '999' }),
    });
    assert.equal(res.status, 404);
  });

  await test('POST — admin adds another player to the roster (201)', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const res = await POST(jsonRequest(url(UPCOMING_SEASON_ID), 'POST', { player_id: OTHER_PLAYER_ID }), {
      params: Promise.resolve({ id: String(UPCOMING_SEASON_ID) }),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(
      seasonPlayersOf(db, UPCOMING_SEASON_ID).map((r) => r.player_id).sort(),
      [PLAYER_ID, OTHER_PLAYER_ID].sort(),
    );
  });

  await test('POST — non-admin adds themselves to the roster (201)', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(OTHER_PLAYER_ID));
    const res = await POST(jsonRequest(url(UPCOMING_SEASON_ID), 'POST', { player_id: OTHER_PLAYER_ID }), {
      params: Promise.resolve({ id: String(UPCOMING_SEASON_ID) }),
    });
    assert.equal(res.status, 201);
    assert.ok(seasonPlayersOf(db, UPCOMING_SEASON_ID).some((r) => r.player_id === OTHER_PLAYER_ID));
  });

  await test('POST — non-admin adding a different player is rejected (403)', async () => {
    installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await POST(jsonRequest(url(UPCOMING_SEASON_ID), 'POST', { player_id: OTHER_PLAYER_ID }), {
      params: Promise.resolve({ id: String(UPCOMING_SEASON_ID) }),
    });
    assert.equal(res.status, 403);
  });

  await test('POST — a player not in the players table is rejected (404)', async () => {
    installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const res = await POST(jsonRequest(url(UPCOMING_SEASON_ID), 'POST', { player_id: 9999 }), {
      params: Promise.resolve({ id: String(UPCOMING_SEASON_ID) }),
    });
    assert.equal(res.status, 404);
  });

  await test('POST — roster edits are rejected once the season is ACTIVE (400)', async () => {
    installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const res = await POST(jsonRequest(url(ACTIVE_SEASON_ID), 'POST', { player_id: OTHER_PLAYER_ID }), {
      params: Promise.resolve({ id: String(ACTIVE_SEASON_ID) }),
    });
    assert.equal(res.status, 400);
  });

  await test('DELETE — unauthenticated request is rejected (401)', async () => {
    installFixture();
    __setTestSession(null);
    const res = await DELETE(jsonRequest(url(UPCOMING_SEASON_ID), 'DELETE', { player_id: PLAYER_ID }), {
      params: Promise.resolve({ id: String(UPCOMING_SEASON_ID) }),
    });
    assert.equal(res.status, 401);
  });

  await test('DELETE — admin removes another player from the roster (200)', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const res = await DELETE(jsonRequest(url(UPCOMING_SEASON_ID), 'DELETE', { player_id: PLAYER_ID }), {
      params: Promise.resolve({ id: String(UPCOMING_SEASON_ID) }),
    });
    assert.equal(res.status, 200);
    assert.equal(seasonPlayersOf(db, UPCOMING_SEASON_ID).length, 0);
  });

  await test('DELETE — non-admin removes themselves from the roster (200)', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await DELETE(jsonRequest(url(UPCOMING_SEASON_ID), 'DELETE', { player_id: PLAYER_ID }), {
      params: Promise.resolve({ id: String(UPCOMING_SEASON_ID) }),
    });
    assert.equal(res.status, 200);
    assert.equal(seasonPlayersOf(db, UPCOMING_SEASON_ID).length, 0);
  });

  await test('DELETE — non-admin removing a different player is rejected (403)', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(OTHER_PLAYER_ID));
    const res = await DELETE(jsonRequest(url(UPCOMING_SEASON_ID), 'DELETE', { player_id: PLAYER_ID }), {
      params: Promise.resolve({ id: String(UPCOMING_SEASON_ID) }),
    });
    assert.equal(res.status, 403);
    assert.equal(seasonPlayersOf(db, UPCOMING_SEASON_ID).length, 1);
  });

  await test('DELETE — roster edits are rejected once the season is ACTIVE (400)', async () => {
    installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const res = await DELETE(jsonRequest(url(ACTIVE_SEASON_ID), 'DELETE', { player_id: PLAYER_ID }), {
      params: Promise.resolve({ id: String(ACTIVE_SEASON_ID) }),
    });
    assert.equal(res.status, 400);
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

main();
