/**
 * Route-handler tests for DELETE /api/players/me/discord (#394) — self-service Discord unlink.
 * Covers the auth gate and that unlink clears discord_id. Never touches @Participants: the role
 * tracks active-season roster membership, not link status, so unlinking makes no Discord API call.
 *
 * Run:  npx vitest run "src/app/api/players/me/discord/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { buildFakeDb } from '@/lib/test-support/fixtures';
import { sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { DELETE } from './route';

const PLAYER_ID = 1; // Alice, per test-support/fixtures.ts.

interface FetchCall {
  url: string;
  method: string;
}

function stubFetch(): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    return { ok: true, status: 204 } as Response;
  }) as typeof fetch;
  return { calls };
}

function freshDb(): { db: FakeDb; client: ReturnType<typeof createFakeSupabaseClient> } {
  const db = buildFakeDb();
  const client = createFakeSupabaseClient(db);
  __setTestAdminClient(client);
  return { db, client };
}

async function main() {
  await test('unauthenticated request is rejected', async () => {
    freshDb();
    __setTestSession(null);
    const res = await DELETE();
    assert.equal(res.status, 401);
  });

  await test('clears discord_id without touching @Participants', async () => {
    const { db } = freshDb();
    db.players.find((p) => p.id === PLAYER_ID)!.discord_id = 'discord-user-1';
    __setTestSession(sessionFor(PLAYER_ID));
    const { calls } = stubFetch();

    const res = await DELETE();

    assert.equal(res.status, 200);
    assert.equal(db.players.find((p) => p.id === PLAYER_ID)!.discord_id, null);
    assert.equal(calls.length, 0);
  });

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
