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
 * Run:  npx vitest run src/app/api/seasons/[id]/players/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestClient } from '@/lib/supabase';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb, type Row } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
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

function seasonPlayersOf(db: FakeDb, seasonId: number): Row[] {
  return db.season_players.filter((r) => r.season_id === seasonId);
}

const url = (seasonId: number | string) => `http://localhost/api/seasons/${seasonId}/players`;

type Handler = typeof POST;

/** Builds and calls the request the same way for every case: a JSON body carrying `player_id`, and
 * the dynamic route's `id` param matching the season id in the URL. */
function call(handler: Handler, method: 'POST' | 'DELETE', seasonId: number | string, playerId: number) {
  return handler(jsonRequest(url(seasonId), method, { player_id: playerId }), {
    params: Promise.resolve({ id: String(seasonId) }),
  });
}

async function main() {
  // Cases that only assert the response status — no roster-state side effect to check.
  const statusOnlyCases: {
    name: string;
    handler: Handler;
    method: 'POST' | 'DELETE';
    sessionPlayerId: number | null;
    seasonId: number | string;
    playerId: number;
    status: number;
  }[] = [
    { name: 'POST — unauthenticated request is rejected (401)', handler: POST, method: 'POST', sessionPlayerId: null, seasonId: UPCOMING_SEASON_ID, playerId: PLAYER_ID, status: 401 },
    { name: 'POST — non-numeric season id is rejected (400)', handler: POST, method: 'POST', sessionPlayerId: ADMIN_ID, seasonId: 'abc', playerId: PLAYER_ID, status: 400 },
    { name: 'POST — unknown season id is rejected (404)', handler: POST, method: 'POST', sessionPlayerId: ADMIN_ID, seasonId: 999, playerId: PLAYER_ID, status: 404 },
    { name: 'POST — non-admin adding a different player is rejected (403)', handler: POST, method: 'POST', sessionPlayerId: PLAYER_ID, seasonId: UPCOMING_SEASON_ID, playerId: OTHER_PLAYER_ID, status: 403 },
    { name: 'POST — a player not in the players table is rejected (404)', handler: POST, method: 'POST', sessionPlayerId: ADMIN_ID, seasonId: UPCOMING_SEASON_ID, playerId: 9999, status: 404 },
    { name: 'POST — roster edits are rejected once the season is ACTIVE (400)', handler: POST, method: 'POST', sessionPlayerId: ADMIN_ID, seasonId: ACTIVE_SEASON_ID, playerId: OTHER_PLAYER_ID, status: 400 },
    { name: 'DELETE — unauthenticated request is rejected (401)', handler: DELETE, method: 'DELETE', sessionPlayerId: null, seasonId: UPCOMING_SEASON_ID, playerId: PLAYER_ID, status: 401 },
    { name: 'DELETE — roster edits are rejected once the season is ACTIVE (400)', handler: DELETE, method: 'DELETE', sessionPlayerId: ADMIN_ID, seasonId: ACTIVE_SEASON_ID, playerId: PLAYER_ID, status: 400 },
  ];
  for (const c of statusOnlyCases) {
    await test(c.name, async () => {
      installFixture();
      __setTestSession(c.sessionPlayerId == null ? null : sessionFor(c.sessionPlayerId));
      const res = await call(c.handler, c.method, c.seasonId, c.playerId);
      assert.equal(res.status, c.status);
    });
  }

  // Cases that also assert the resulting `season_players` roster state, kept as individual tests.
  await test('POST — admin adds another player to the roster (201)', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const res = await call(POST, 'POST', UPCOMING_SEASON_ID, OTHER_PLAYER_ID);
    assert.equal(res.status, 201);
    assert.deepEqual(
      seasonPlayersOf(db, UPCOMING_SEASON_ID).map((r) => r.player_id).sort(),
      [PLAYER_ID, OTHER_PLAYER_ID].sort(),
    );
  });

  await test('POST — non-admin adds themselves to the roster (201)', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(OTHER_PLAYER_ID));
    const res = await call(POST, 'POST', UPCOMING_SEASON_ID, OTHER_PLAYER_ID);
    assert.equal(res.status, 201);
    assert.ok(seasonPlayersOf(db, UPCOMING_SEASON_ID).some((r) => r.player_id === OTHER_PLAYER_ID));
  });

  await test('DELETE — admin removes another player from the roster (200)', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const res = await call(DELETE, 'DELETE', UPCOMING_SEASON_ID, PLAYER_ID);
    assert.equal(res.status, 200);
    assert.equal(seasonPlayersOf(db, UPCOMING_SEASON_ID).length, 0);
  });

  await test('DELETE — non-admin removes themselves from the roster (200)', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    const res = await call(DELETE, 'DELETE', UPCOMING_SEASON_ID, PLAYER_ID);
    assert.equal(res.status, 200);
    assert.equal(seasonPlayersOf(db, UPCOMING_SEASON_ID).length, 0);
  });

  await test('DELETE — non-admin removing a different player is rejected (403)', async () => {
    const db = installFixture();
    __setTestSession(sessionFor(OTHER_PLAYER_ID));
    const res = await call(DELETE, 'DELETE', UPCOMING_SEASON_ID, PLAYER_ID);
    assert.equal(res.status, 403);
    assert.equal(seasonPlayersOf(db, UPCOMING_SEASON_ID).length, 1);
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
