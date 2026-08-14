/**
 * Covers `requireMatchAccess()`'s four outcomes: site admin, in-match player, out-of-match player,
 * no session. Uses the shared `test-support/fixtures.ts` `PLAYERS` list (Alice, id 1,
 * `is_admin: true`; everyone else `is_admin: false`) for the admin-vs-non-admin distinction, plus a
 * small local `player_match_stats` roster for one match — both read through the admin client, since
 * `requireMatchAccess()` reads `players`/`player_match_stats` via `getAdminClient()` directly rather
 * than `isPlayerAdmin()`.
 *
 * Run:  npx vitest run src/lib/match-access.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from './session';
import { __setTestAdminClient } from './supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from './test-support/fakeSupabase';
import { PLAYERS } from './test-support/fixtures';
import { sessionFor } from './test-support/nextRequest';
import { test, report } from './test-support/miniTest';
import { requireMatchAccess } from './match-access';

const ADMIN_ID = 1; // Alice — is_admin: true, not rostered on MATCH_ID
const IN_MATCH_PLAYER_ID = 2; // Bob — is_admin: false, rostered on MATCH_ID
const OUT_OF_MATCH_PLAYER_ID = 4; // Dave — is_admin: false, not rostered on MATCH_ID
const MATCH_ID = 5000;

function installFixture(): void {
  const db: FakeDb = {
    players: PLAYERS,
    player_match_stats: [
      { match_id: MATCH_ID, player_id: IN_MATCH_PLAYER_ID },
      { match_id: MATCH_ID, player_id: 3 },
    ],
  };
  __setTestAdminClient(createFakeSupabaseClient(db));
}

async function main() {
  await test('site admin is granted access (not rostered on the match)', async () => {
    installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const result = await requireMatchAccess(MATCH_ID);
    assert.deepEqual(result, { ok: true, playerId: ADMIN_ID, isAdmin: true });
  });

  await test('in-match player is granted access', async () => {
    installFixture();
    __setTestSession(sessionFor(IN_MATCH_PLAYER_ID));
    const result = await requireMatchAccess(MATCH_ID);
    assert.deepEqual(result, { ok: true, playerId: IN_MATCH_PLAYER_ID, isAdmin: false });
  });

  await test('out-of-match, non-admin player is rejected (403)', async () => {
    installFixture();
    __setTestSession(sessionFor(OUT_OF_MATCH_PLAYER_ID));
    const result = await requireMatchAccess(MATCH_ID);
    assert.deepEqual(result, { ok: false, status: 403, error: 'Forbidden' });
  });

  await test('no session is rejected (401)', async () => {
    installFixture();
    __setTestSession(null);
    const result = await requireMatchAccess(MATCH_ID);
    assert.deepEqual(result, { ok: false, status: 401, error: 'Unauthorized' });
  });

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
