/**
 * Route-handler harness for GET /api/players/[id]/summary — a player's career snapshot for the
 * hover card, through the exported handler directly.
 *
 * Run:  npx vitest run src/app/api/players/[id]/summary/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient } from '@/lib/test-support/fakeSupabase';
import { buildFakeDb } from '@/lib/test-support/fixtures';
import { test, report } from '@/lib/test-support/miniTest';
import { GET } from './route';

__setTestAdminClient(createFakeSupabaseClient(buildFakeDb()));

const call = (id: string) =>
  GET(new Request(`http://localhost/api/players/${id}/summary`), { params: Promise.resolve({ id }) });

async function main() {
  await test('GET — a known player returns their summary (200)', async () => {
    const res = await call('1');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.playerId, 1);
    assert.equal(typeof body.playerName, 'string');
    assert.ok(Array.isArray(body.recent));
    assert.ok(body.recent.length <= 5);
  });

  await test('GET — an unknown player is a 404', async () => {
    assert.equal((await call('999999')).status, 404);
  });

  await test('GET — a non-numeric id is a 400', async () => {
    assert.equal((await call('abc')).status, 400);
  });

  report();
}

await main();
