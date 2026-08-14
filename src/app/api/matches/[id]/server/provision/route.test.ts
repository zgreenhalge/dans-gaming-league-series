/**
 * Route-handler harness for POST /api/matches/[id]/server/provision (#379) — exercises
 * requireMatchAccess()'s admin-or-in-match gate, the hosting-not-configured and server-busy
 * pre-checks, and that the deferred provisionMatchServer() call actually fires (and its failure is
 * handled, not left unhandled) via __setTestAfterMode()/__flushTestAfter().
 *
 * No live DatHost connection exists here, so provisionMatchServer() itself always fails fast (no
 * DATHOST_SERVER_ID configured, or no real network) — per docs/patterns.md's IO-boundary convention,
 * this test doesn't mock the DatHost call, it only asserts the failure is captured via
 * provisionErrorHandler()'s recordOpsError(), the same as veto/route.test.ts's auto-provision case.
 *
 * Run:  npx vitest run "src/app/api/matches/[id]/server/provision/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestClient } from '@/lib/supabase';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { __setTestAfterMode, __flushTestAfter } from '@/lib/after';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { POST } from './route';

const ADMIN_ID = 1;
const IN_MATCH_ID = 2;
const OUT_OF_MATCH_ID = 3;
const MATCH_ID = 100;
const BUSY_MATCH_ID = 101;
const OCCUPYING_MATCH_ID = 999;

function makeDb(): FakeDb {
  return {
    players: [
      { id: ADMIN_ID, is_admin: true },
      { id: IN_MATCH_ID, is_admin: false },
      { id: OUT_OF_MATCH_ID, is_admin: false },
    ],
    player_match_stats: [
      { id: 1, match_id: MATCH_ID, player_id: IN_MATCH_ID, faction: 'SHIRTS' },
      { id: 2, match_id: BUSY_MATCH_ID, player_id: IN_MATCH_ID, faction: 'SHIRTS' },
    ],
    match_server_state: [
      { match_id: OCCUPYING_MATCH_ID, server_state: 'live', dathost_server_id: 'srv-1', connect_string: '1.2.3.4:27015', server_started_at: null, teardown_at: null },
    ],
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

const url = (matchId: number | string) => `http://localhost/api/matches/${matchId}/server/provision`;

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

  await test('POST — hosting not configured is rejected (503)', async () => {
    installFixture();
    delete process.env.MATCHZY_CONFIG_SECRET;
    const res = await call(MATCH_ID, ADMIN_ID);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'Server hosting not configured');
  });

  await test('POST — another match already occupying the shared server is rejected (409)', async () => {
    installFixture();
    process.env.MATCHZY_CONFIG_SECRET = 'test-secret';
    process.env.DATHOST_SERVER_ID = 'srv-1';
    const res = await call(BUSY_MATCH_ID, ADMIN_ID);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.ok(body.error.includes(`#${OCCUPYING_MATCH_ID}`));
    assert.equal(body.code, 'server_busy');
    delete process.env.DATHOST_SERVER_ID;
  });

  await test('POST — the in-match player (non-admin) can provision (202), and the deferred call runs', async () => {
    __setTestAfterMode(true);
    const db = installFixture();
    process.env.MATCHZY_CONFIG_SECRET = 'test-secret';
    const res = await call(MATCH_ID, IN_MATCH_ID);
    assert.equal(res.status, 202);
    assert.deepEqual(await res.clone().json(), { ok: true, status: 'provisioning' });

    await __flushTestAfter();
    // No DATHOST_SERVER_ID configured here — provisionMatchServer() fails fast; the deferred call
    // having run (and its failure captured, not left unhandled) is what this asserts.
    assert.ok(db.ops_errors.some((e) => e.entity_id === MATCH_ID && e.operation === 'server_provision'));

    delete process.env.MATCHZY_CONFIG_SECRET;
    __setTestAfterMode(false);
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
