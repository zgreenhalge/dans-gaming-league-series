/**
 * Covers `requireSeasonRosterAccess()`'s admin-or-self decision directly (as opposed to
 * `src/app/api/seasons/[id]/players/route.test.ts`, which exercises it indirectly through the
 * route) plus `mapSeasonRosterWriteError()`'s error-code-to-status mapping. Uses the shared
 * `test-support/fixtures.ts` `PLAYERS` list (Alice, id 1, `is_admin: true`; everyone else
 * `is_admin: false`) for the admin-vs-self distinction, wired as both the anon client
 * (`isPlayerAdmin()`) and the admin client (the `seasons` read) — the same one-fake-client-for-both
 * pattern the route test uses.
 *
 * Run:  npx tsx src/lib/season-roster-access.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from './session';
import { __setTestClient } from './supabase';
import { __setTestAdminClient } from './supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from './test-support/fakeSupabase';
import { PLAYERS } from './test-support/fixtures';
import { jsonRequest, sessionFor } from './test-support/nextRequest';
import { test, report } from './test-support/miniTest';
import { requireSeasonRosterAccess, mapSeasonRosterWriteError } from './season-roster-access';

const ADMIN_ID = 1; // Alice — is_admin: true
const PLAYER_ID = 2; // Bob — is_admin: false
const OTHER_PLAYER_ID = 3; // Carol — is_admin: false
const UPCOMING_SEASON_ID = 10;

function installFixture(): void {
  const db: FakeDb = {
    players: PLAYERS,
    seasons: [{ id: UPCOMING_SEASON_ID, status: 'UPCOMING' }],
  };
  const client = createFakeSupabaseClient(db);
  __setTestClient(client);
  __setTestAdminClient(client);
}

function request(playerId: number) {
  return jsonRequest(`http://localhost/api/seasons/${UPCOMING_SEASON_ID}/players`, 'POST', { player_id: playerId });
}

async function main() {
  await test('admin acting on another player is granted access', async () => {
    installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const result = await requireSeasonRosterAccess(request(OTHER_PLAYER_ID), UPCOMING_SEASON_ID);
    assert.ok(result.ok);
    assert.equal(result.targetPlayerId, OTHER_PLAYER_ID);
  });

  await test('a player acting on themself is granted access', async () => {
    installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    const result = await requireSeasonRosterAccess(request(PLAYER_ID), UPCOMING_SEASON_ID);
    assert.ok(result.ok);
    assert.equal(result.targetPlayerId, PLAYER_ID);
  });

  await test('a player acting on someone else is denied (403)', async () => {
    installFixture();
    __setTestSession(sessionFor(PLAYER_ID));
    const result = await requireSeasonRosterAccess(request(OTHER_PLAYER_ID), UPCOMING_SEASON_ID);
    assert.deepEqual(result, { ok: false, status: 403, error: 'Forbidden' });
  });

  await test('mapSeasonRosterWriteError maps the trigger error code to 400', () => {
    const mapped = mapSeasonRosterWriteError({ code: 'P0001', message: 'season_players_upcoming_only violated' });
    assert.deepEqual(mapped, { error: 'Roster can only be edited while the season is UPCOMING', status: 400 });
  });

  await test('mapSeasonRosterWriteError maps any other error code to 500', () => {
    const mapped = mapSeasonRosterWriteError({ code: '23505', message: 'duplicate key value' });
    assert.deepEqual(mapped, { error: 'duplicate key value', status: 500 });
  });

  await test('mapSeasonRosterWriteError maps a missing error code to 500', () => {
    const mapped = mapSeasonRosterWriteError({ message: 'connection reset' });
    assert.deepEqual(mapped, { error: 'connection reset', status: 500 });
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

main();
