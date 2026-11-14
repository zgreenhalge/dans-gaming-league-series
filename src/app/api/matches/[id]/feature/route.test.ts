/**
 * Route-handler tests for PATCH /api/matches/[id]/feature — the admin-only gate (an in-match player
 * is not enough), body validation, setting and clearing `is_feature_match`, and a write failure as a
 * 500.
 *
 * Run:  npx vitest run "src/app/api/matches/[id]/feature/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { clientFailingOn, createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, MALFORMED_ROUTE_IDS, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { PATCH } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2; // in the match, not an admin
const MATCH_ID = 100;

function makeDb(): FakeDb {
  return {
    players: [
      { id: ADMIN_ID, is_admin: true, name: 'Admin' },
      { id: PLAYER_ID, is_admin: false, name: 'Player' },
    ],
    matches: [{ id: MATCH_ID, week_id: 1, is_feature_match: false }],
    player_match_stats: [{ id: 1, match_id: MATCH_ID, player_id: PLAYER_ID, faction: 'SHIRTS' }],
  };
}

function installFixture(wrap?: (client: ReturnType<typeof createFakeSupabaseClient>) => ReturnType<typeof createFakeSupabaseClient>) {
  const db = makeDb();
  const client = createFakeSupabaseClient(db);
  __setTestAdminClient(wrap ? wrap(client) : client);
  return db;
}

const url = (matchId: number | string) => `http://localhost/api/matches/${matchId}/feature`;

function call(matchId: number | string, sessionPlayerId: number | null, body?: unknown) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return PATCH(jsonRequest(url(matchId), 'PATCH', body), { params: Promise.resolve({ id: String(matchId) }) });
}

const featured = (db: FakeDb) => db.matches.find((m) => m.id === MATCH_ID)!.is_feature_match;

async function main() {
  await test('PATCH — unauthenticated request is rejected (401)', async () => {
    const db = installFixture();
    assert.equal((await call(MATCH_ID, null, { is_feature_match: true })).status, 401);
    assert.equal(featured(db), false);
  });

  await test('PATCH — a player in the match who is not an admin is rejected (403)', async () => {
    const db = installFixture();
    assert.equal((await call(MATCH_ID, PLAYER_ID, { is_feature_match: true })).status, 403);
    assert.equal(featured(db), false);
  });

  await test('PATCH — a malformed match id is rejected (400)', async () => {
    installFixture();
    for (const bad of MALFORMED_ROUTE_IDS) {
      assert.equal((await call(bad, ADMIN_ID, { is_feature_match: true })).status, 400, `id ${JSON.stringify(bad)}`);
    }
  });

  await test('PATCH — a missing or non-boolean is_feature_match is rejected (400)', async () => {
    const db = installFixture();
    assert.equal((await call(MATCH_ID, ADMIN_ID)).status, 400);
    assert.equal((await call(MATCH_ID, ADMIN_ID, {})).status, 400);
    assert.equal((await call(MATCH_ID, ADMIN_ID, { is_feature_match: 'true' })).status, 400);
    assert.equal((await call(MATCH_ID, ADMIN_ID, { is_feature_match: 1 })).status, 400);
    assert.equal((await call(MATCH_ID, ADMIN_ID, { is_feature_match: null })).status, 400);
    assert.equal(featured(db), false);
  });

  await test('PATCH — an admin features a match and un-features it again', async () => {
    const db = installFixture();
    const on = await call(MATCH_ID, ADMIN_ID, { is_feature_match: true });
    assert.equal(on.status, 200);
    assert.deepEqual(await on.json(), { ok: true, is_feature_match: true });
    assert.equal(featured(db), true);

    const off = await call(MATCH_ID, ADMIN_ID, { is_feature_match: false });
    assert.equal(off.status, 200);
    assert.deepEqual(await off.json(), { ok: true, is_feature_match: false });
    assert.equal(featured(db), false);
  });

  await test('PATCH — a write failure is a 500, and the flag is unchanged', async () => {
    const db = installFixture((c) => clientFailingOn(c, 'matches', 'update', { code: 'XX000', message: 'connection reset' }));
    const res = await call(MATCH_ID, ADMIN_ID, { is_feature_match: true });
    assert.equal(res.status, 500);
    assert.equal(featured(db), false);
  });

  await test('PATCH — an unknown match is a 404', async () => {
    installFixture();
    assert.equal((await call(999, ADMIN_ID, { is_feature_match: true })).status, 404);
  });

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
