/**
 * Route-handler harness for DELETE /api/ops-errors/[id] — admin gate, `[id]` validation, and the
 * soft-dismiss write, through the exported handler directly.
 *
 * Run:  npx vitest run src/app/api/ops-errors/[id]/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, MALFORMED_ROUTE_IDS, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { DELETE } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const OPS_ERROR_ID = 7;

function installFixture(): FakeDb {
  const db: FakeDb = {
    players: [
      { id: ADMIN_ID, is_admin: true },
      { id: PLAYER_ID, is_admin: false },
    ],
    ops_errors: [{ id: OPS_ERROR_ID, entity_type: 'system', entity_id: 0, dismissed_at: null }],
  };
  const client = createFakeSupabaseClient(db);
  __setTestAdminClient(client);
  return db;
}

function call(id: string, sessionPlayerId: number | null) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return DELETE(jsonRequest(`http://localhost/api/ops-errors/${id}`, 'DELETE'), {
    params: Promise.resolve({ id }),
  });
}

async function main() {
  await test('DELETE — unauthenticated (401) and non-admin (403) are rejected', async () => {
    installFixture();
    assert.equal((await call(String(OPS_ERROR_ID), null)).status, 401);
    assert.equal((await call(String(OPS_ERROR_ID), PLAYER_ID)).status, 403);
  });

  await test('DELETE — a malformed id is rejected (400) without writing', async () => {
    const db = installFixture();
    for (const bad of MALFORMED_ROUTE_IDS) {
      assert.equal((await call(bad, ADMIN_ID)).status, 400, `id ${JSON.stringify(bad)}`);
    }
    assert.equal(db.ops_errors[0].dismissed_at, null);
  });

  await test('DELETE — admin dismisses the row (200)', async () => {
    const db = installFixture();
    const res = await call(String(OPS_ERROR_ID), ADMIN_ID);
    assert.equal(res.status, 200);
    assert.ok(db.ops_errors[0].dismissed_at);
  });

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
