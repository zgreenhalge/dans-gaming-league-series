/**
 * Route-handler harness for POST /api/players/register's new-player branch: the name rule
 * (`normalizePlayerName()` + `isValidPlayerName()`) applies at registration the same as on a rename.
 *
 * Run:  npx vitest run src/app/api/players/register/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { POST } from './route';

const STEAM_ID = '76561198000000001';

function installFixture(): FakeDb {
  const db: FakeDb = { players: [] };
  __setTestAdminClient(createFakeSupabaseClient(db));
  return db;
}

function register(name: unknown) {
  __setTestSession({ user: { steamId: STEAM_ID }, expires: '2099-01-01T00:00:00.000Z' } as never);
  return POST(jsonRequest('http://localhost/api/players/register', 'POST', { name }));
}

async function main() {
  // No Steam profile lookup in tests: the route treats a failed fetch as "no profile".
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as typeof fetch;

  await test('POST — a name that breaks the rule is rejected (400) and nothing is written', async () => {
    for (const bad of ['xX_Sniper99_Xx', 'A', 'a'.repeat(33), 'Dan2']) {
      const db = installFixture();
      const res = await register(bad);
      assert.equal(res.status, 400, bad);
      assert.match((await res.json()).error, /^Name must be /);
      assert.equal(db.players.length, 0);
    }
  });

  await test('POST — a missing name is rejected (400)', async () => {
    installFixture();
    assert.equal((await register('   ')).status, 400);
    assert.equal((await register(undefined)).status, 400);
  });

  await test('POST — a valid name is stored normalized, with internal whitespace collapsed', async () => {
    const db = installFixture();
    const res = await register('  Big   Dan ');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).playerName, 'Big Dan');
    assert.equal(db.players[0]?.name, 'Big Dan');
  });

  globalThis.fetch = realFetch;
  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
