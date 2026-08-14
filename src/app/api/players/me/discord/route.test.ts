/**
 * Route-handler tests for DELETE /api/players/me/discord (#394) — self-service Discord unlink.
 * Covers the auth gate and that unlink clears discord_id while deferring a revoke call keyed to the
 * *prior* discord_id (the whole reason the route reads it before clearing the column).
 *
 * Run:  npx vitest run "src/app/api/players/me/discord/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { __setTestAfterMode, __flushTestAfter } from '@/lib/after';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { buildFakeDb } from '@/lib/test-support/fixtures';
import { sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { DELETE } from './route';

const PLAYER_ID = 1; // Alice, per test-support/fixtures.ts.

const ENV_KEYS = ['DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID', 'DISCORD_PARTICIPANTS_ROLE_ID'] as const;

function setEnv() {
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  process.env.DISCORD_GUILD_ID = 'test-guild-id';
  process.env.DISCORD_PARTICIPANTS_ROLE_ID = 'test-role-id';
}

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

interface FetchCall {
  url: string;
  method: string;
}

function stubFetch(status = 204): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    return { ok: status >= 200 && status < 300, status } as Response;
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

  await test('clears discord_id and defers a revoke call keyed to the prior discord_id', async () => {
    setEnv();
    __setTestAfterMode(true);
    const { db } = freshDb();
    db.players.find((p) => p.id === PLAYER_ID)!.discord_id = 'discord-user-1';
    __setTestSession(sessionFor(PLAYER_ID));
    const { calls } = stubFetch();

    const res = await DELETE();
    await __flushTestAfter();

    assert.equal(res.status, 200);
    assert.equal(db.players.find((p) => p.id === PLAYER_ID)!.discord_id, null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'DELETE');
    assert.match(calls[0].url, /discord-user-1/);

    __setTestAfterMode(false);
  });

  await test('unlinking an already-unlinked player is a no-op revoke (nothing to call)', async () => {
    setEnv();
    __setTestAfterMode(true);
    freshDb();
    __setTestSession(sessionFor(PLAYER_ID));
    const { calls } = stubFetch();

    const res = await DELETE();
    await __flushTestAfter();

    assert.equal(res.status, 200);
    assert.equal(calls.length, 0);

    __setTestAfterMode(false);
  });

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  clearEnv();
  report();
}

await main();
