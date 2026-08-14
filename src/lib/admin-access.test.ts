/**
 * Covers `requireAdminAccess()`'s three outcomes: admin session, non-admin session, no session.
 * Uses the shared `test-support/fixtures.ts` `PLAYERS` list (Alice, id 1, `is_admin: true`;
 * everyone else `is_admin: false`) as the admin-vs-non-admin fixture, wired as the anon client
 * `isPlayerAdmin()` reads through.
 *
 * Run:  npx vitest run src/lib/admin-access.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from './session';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { PLAYERS } from './test-support/fixtures';
import { sessionFor } from './test-support/nextRequest';
import { test, report } from './test-support/miniTest';
import { requireAdminAccess } from './admin-access';

const ADMIN_ID = 1; // Alice — is_admin: true
const NON_ADMIN_ID = 2; // Bob — is_admin: false

function installFixture(): void {
  __setTestClient(createFakeSupabaseClient({ players: PLAYERS }));
}

async function main() {
  await test('admin session is granted access', async () => {
    installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const result = await requireAdminAccess();
    assert.deepEqual(result, { ok: true, playerId: ADMIN_ID });
  });

  await test('non-admin session is rejected (403)', async () => {
    installFixture();
    __setTestSession(sessionFor(NON_ADMIN_ID));
    const result = await requireAdminAccess();
    assert.deepEqual(result, { ok: false, status: 403, error: 'Forbidden' });
  });

  await test('no session is rejected (401)', async () => {
    installFixture();
    __setTestSession(null);
    const result = await requireAdminAccess();
    assert.deepEqual(result, { ok: false, status: 401, error: 'Unauthorized' });
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  report();
}

await main();
