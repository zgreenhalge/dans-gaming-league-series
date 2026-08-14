/**
 * Route-handler harness for POST /api/matches/[id]/server/teardown (#379) — exercises
 * requireMatchAccess()'s admin-or-in-match gate directly (no deferred work here — unlike provision,
 * this route awaits teardownMatchServer() synchronously, so no after()-seam is needed).
 *
 * No live DatHost connection exists in this environment, so teardownMatchServer() always fails fast
 * (no DATHOST_SERVER_ID configured) — per docs/patterns.md's IO-boundary convention this doesn't mock
 * the DatHost call; it asserts the route's own catch/recordOpsError/502 handling of that failure,
 * which is itself real, exercised behavior.
 *
 * Run:  npx vitest run "src/app/api/matches/[id]/server/teardown/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestClient } from '@/lib/supabase';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { POST } from './route';

const ADMIN_ID = 1;
const IN_MATCH_ID = 2;
const OUT_OF_MATCH_ID = 3;
const MATCH_ID = 100;

function makeDb(): FakeDb {
  return {
    players: [
      { id: ADMIN_ID, is_admin: true },
      { id: IN_MATCH_ID, is_admin: false },
      { id: OUT_OF_MATCH_ID, is_admin: false },
    ],
    player_match_stats: [{ id: 1, match_id: MATCH_ID, player_id: IN_MATCH_ID, faction: 'SHIRTS' }],
    match_server_state: [],
    ops_errors: [],
  };
}

function installFixture(): FakeDb {
  const db = makeDb();
  const client = createFakeSupabaseClient(db);
  __setTestClient(client);
  __setTestAdminClient(client);
  return db;
}

const url = (matchId: number | string) => `http://localhost/api/matches/${matchId}/server/teardown`;

function call(matchId: number | string, sessionPlayerId: number | null) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return POST(jsonRequest(url(matchId), 'POST'), { params: Promise.resolve({ id: String(matchId) }) });
}

async function main() {
  await test('POST — non-numeric match id is rejected (400)', async () => {
    installFixture();
    assert.equal((await call('abc', ADMIN_ID)).status, 400);
  });

  await test('POST — unauthenticated request is rejected (401)', async () => {
    installFixture();
    assert.equal((await call(MATCH_ID, null)).status, 401);
  });

  await test('POST — a player outside the match is rejected (403)', async () => {
    installFixture();
    assert.equal((await call(MATCH_ID, OUT_OF_MATCH_ID)).status, 403);
  });

  await test('POST — the in-match player (non-admin) passes the access gate', async () => {
    const db = installFixture();
    delete process.env.DATHOST_SERVER_ID;
    const res = await call(MATCH_ID, IN_MATCH_ID);
    // No live DatHost connection here, so teardownMatchServer() itself fails (502) — the point of
    // this test is that access was granted (not a 401/403), and the failure is captured, not thrown
    // bare.
    assert.equal(res.status, 502);
    assert.ok(db.ops_errors.some((e) => e.entity_id === MATCH_ID && e.operation === 'server_teardown'));
  });

  await test('POST — a teardown failure records an ops-error and returns its message (502)', async () => {
    const db = installFixture();
    delete process.env.DATHOST_SERVER_ID;
    const res = await call(MATCH_ID, ADMIN_ID);
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error, 'DATHOST_SERVER_ID must be set');
    assert.ok(db.ops_errors.some((e) => e.message === 'Server teardown failed: DATHOST_SERVER_ID must be set'));
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
