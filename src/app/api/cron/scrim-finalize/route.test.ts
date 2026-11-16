/**
 * Route-handler harness for POST /api/cron/scrim-finalize — the CRON_SECRET bearer gate, and that an
 * ended night whose message still shows a match is finalized. The message itself is covered by
 * src/lib/discord-scrim-notify.test.ts.
 *
 * Run:  npx vitest run "src/app/api/cron/scrim-finalize/route.test.ts"
 */

import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { idleFor, scrimNightStartingIn } from '@/lib/test-support/scrimFixtures';
import { test, report } from '@/lib/test-support/miniTest';
import { POST } from './route';

const HOUR = 60 * 60 * 1000;
const request = (auth?: string) =>
  new NextRequest('http://localhost/api/cron/scrim-finalize', { method: 'POST', headers: auth ? { authorization: auth } : {}, body: '{}' });

function installFixture(): FakeDb {
  const db: FakeDb = {
    players: [{ id: 1, name: 'Ann', discord_name_role_id: null }],
    // Started 3 hours ago, idle for 2: over.
    scrim_nights: [idleFor(scrimNightStartingIn(-3 * HOUR, 5), 2 * HOUR)],
    scrim_signups: [{ id: 1, night_id: 5, player_id: 1, commitment: 'definite', signed_up_at: '2026-01-01T00:00:00Z', checked_in_at: null }],
    scrim_night_discord_state: [{ night_id: 5, announcement_message_id: null, reminder_message_id: 'msg', reminder_sent_at: '2026-01-01T00:00:00Z', finalized_at: null }],
    matches: [],
  };
  __setTestAdminClient(createFakeSupabaseClient(db));
  return db;
}

// Env vars are set inside each test body: vitest defers test callbacks until after main() returns.
async function main() {
  await test('POST — a missing or wrong bearer token is rejected (401)', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    installFixture();
    assert.equal((await POST(request())).status, 401);
    assert.equal((await POST(request('Bearer wrong'))).status, 401);
  });

  await test('POST — finalizes an ended night whose message is not final yet', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    const db = installFixture();
    const methods: string[] = [];
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (_url: string, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;

    const res = await POST(request('Bearer test-cron-secret'));
    assert.equal(res.status, 200);
    assert.deepEqual(methods, ['PATCH']);
    assert.ok(db.scrim_night_discord_state[0].finalized_at);
    delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  });

  report();
}

await main();
