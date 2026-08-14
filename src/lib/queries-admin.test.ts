/**
 * Regression harness for queries.ts's admin-console functions (#63) — getAdminMatches,
 * getAdminPlayers, isPlayerAdmin. getAdminMatches exercises the fake client's embedded-select
 * (`matches -> weeks -> seasons`) resolution.
 *
 * Run:  npx vitest run src/lib/queries-admin.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getAdminMatches, getAdminPlayers, isPlayerAdmin } from './queries';
import { test, report } from './test-support/miniTest';

async function main() {
  await test('getAdminMatches() — includes pagination filler, but real matches resolve correctly', async () => {
    const rows = await getAdminMatches();
    const real = rows.filter((r) => r.match.id < 1000);
    assert.equal(real.length, 6);
    matchesSnapshot('getAdminMatches-real', real);
  });

  await test('getAdminPlayers() — sorted by name, snapshot', async () => {
    const players = await getAdminPlayers();
    assert.equal(players.length, 8);
    // Alphabetical: Alice, Bob, Carol, Dave, Erin, Frank, Grace, Heidi
    assert.deepEqual(players.map((p) => p.name), ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Grace', 'Heidi']);
    matchesSnapshot('getAdminPlayers', players);
  });

  await test('isPlayerAdmin(1) — Alice is an admin', async () => {
    assert.equal(await isPlayerAdmin(1), true);
  });

  await test('isPlayerAdmin(2) — Bob is not an admin', async () => {
    assert.equal(await isPlayerAdmin(2), false);
  });

  await test('isPlayerAdmin(9999) — nonexistent player is not an admin', async () => {
    assert.equal(await isPlayerAdmin(9999), false);
  });

  report();
}

await main();
