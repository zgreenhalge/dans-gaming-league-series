/**
 * Route-handler tests for POST /api/matches/[id]/recording — the admin-or-in-match gate, body
 * validation, setting and clearing `recording_url`, and a write failure as a 500.
 *
 * Run:  npx vitest run "src/app/api/matches/[id]/recording/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { clientFailingOn, createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, MALFORMED_ROUTE_IDS, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { POST } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2; // in the match, not an admin
const OUTSIDER_ID = 3;
const MATCH_ID = 100;
const RECORDING = 'https://www.youtube.com/watch?v=abc123';

function makeDb(): FakeDb {
  return {
    players: [
      { id: ADMIN_ID, is_admin: true, name: 'Admin' },
      { id: PLAYER_ID, is_admin: false, name: 'Player' },
      { id: OUTSIDER_ID, is_admin: false, name: 'Outsider' },
    ],
    matches: [{ id: MATCH_ID, week_id: 1, recording_url: null }],
    player_match_stats: [{ id: 1, match_id: MATCH_ID, player_id: PLAYER_ID, faction: 'SHIRTS' }],
  };
}

function installFixture(wrap?: (client: ReturnType<typeof createFakeSupabaseClient>) => ReturnType<typeof createFakeSupabaseClient>) {
  const db = makeDb();
  const client = createFakeSupabaseClient(db);
  __setTestAdminClient(wrap ? wrap(client) : client);
  return db;
}

const url = (matchId: number | string) => `http://localhost/api/matches/${matchId}/recording`;

function call(matchId: number | string, sessionPlayerId: number | null, body?: unknown) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return POST(jsonRequest(url(matchId), 'POST', body), { params: Promise.resolve({ id: String(matchId) }) });
}

const recording = (db: FakeDb) => db.matches.find((m) => m.id === MATCH_ID)!.recording_url;

async function main() {
  await test('POST — a malformed match id is rejected (400)', async () => {
    installFixture();
    for (const bad of MALFORMED_ROUTE_IDS) {
      assert.equal((await call(bad, ADMIN_ID, { value: RECORDING })).status, 400, `id ${JSON.stringify(bad)}`);
    }
  });

  await test('POST — unauthenticated request is rejected (401)', async () => {
    const db = installFixture();
    assert.equal((await call(MATCH_ID, null, { value: RECORDING })).status, 401);
    assert.equal(recording(db), null);
  });

  await test('POST — a player outside the match who is not an admin is rejected (403)', async () => {
    const db = installFixture();
    assert.equal((await call(MATCH_ID, OUTSIDER_ID, { value: RECORDING })).status, 403);
    assert.equal(recording(db), null);
  });

  await test('POST — a missing or non-string value is rejected (400)', async () => {
    const db = installFixture();
    assert.equal((await call(MATCH_ID, ADMIN_ID)).status, 400);
    assert.equal((await call(MATCH_ID, ADMIN_ID, {})).status, 400);
    assert.equal((await call(MATCH_ID, ADMIN_ID, { value: 42 })).status, 400);
    assert.equal((await call(MATCH_ID, ADMIN_ID, { value: false })).status, 400);
    assert.equal(recording(db), null);
  });

  await test('POST — a player in the match sets the recording', async () => {
    const db = installFixture();
    const res = await call(MATCH_ID, PLAYER_ID, { value: RECORDING });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true });
    assert.equal(recording(db), RECORDING);
  });

  await test('POST — an admin who is not in the match sets the recording, then clears it with null', async () => {
    const db = installFixture();
    assert.equal((await call(MATCH_ID, ADMIN_ID, { value: RECORDING })).status, 200);
    assert.equal(recording(db), RECORDING);
    assert.equal((await call(MATCH_ID, ADMIN_ID, { value: null })).status, 200);
    assert.equal(recording(db), null);
  });

  await test('POST — a write failure is a 500 carrying the database message, and the recording is unchanged', async () => {
    const db = installFixture((c) => clientFailingOn(c, 'matches', 'update', { code: 'XX000', message: 'connection reset' }));
    const res = await call(MATCH_ID, ADMIN_ID, { value: RECORDING });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, 'connection reset');
    assert.equal(recording(db), null);
  });

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
