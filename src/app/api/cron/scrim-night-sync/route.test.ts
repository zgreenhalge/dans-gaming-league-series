/**
 * Route-handler harness for POST /api/cron/scrim-night-sync — the CRON_SECRET bearer gate, the nightId
 * body validation, and that the call syncs the night's message (here: the final standings, for a night
 * that went idle) and 200s. What the sync renders is covered by src/lib/discord-scrim-notify.test.ts.
 *
 * Run:  npx vitest run "src/app/api/cron/scrim-night-sync/route.test.ts"
 */

import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { idleFor, scrimNightStartingIn } from '@/lib/test-support/scrimFixtures';
import { test, report } from '@/lib/test-support/miniTest';
import { POST } from './route';

const URL = 'http://localhost/api/cron/scrim-night-sync';
const HOUR = 60 * 60 * 1000;

function request(body: unknown, auth?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth !== undefined) headers.authorization = auth;
  return new NextRequest(URL, { method: 'POST', headers, body: JSON.stringify(body) });
}

function installFixture(): FakeDb {
  const db: FakeDb = {
    players: [{ id: 1, name: 'Ann', discord_name_role_id: null, steam_avatar_url: null }],
    scrim_nights: [idleFor(scrimNightStartingIn(-3 * HOUR, 5), 2 * HOUR)],
    scrim_signups: [{ id: 1, night_id: 5, player_id: 1, commitment: 'definite', signed_up_at: '2026-01-01T00:00:00Z', checked_in_at: null }],
    scrim_night_discord_state: [{ night_id: 5, announcement_message_id: null, reminder_message_id: 'night', reminder_sent_at: '2026-01-01T00:00:00Z', finalized_at: null }],
    matches: [],
    player_match_stats: [],
    match_server_state: [],
    live_match_score: [],
    ops_errors: [],
  };
  __setTestAdminClient(createFakeSupabaseClient(db));
  return db;
}

async function main() {
  await test('POST — a missing or wrong bearer token is rejected (401)', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    installFixture();
    assert.equal((await POST(request({ nightId: 5 }))).status, 401);
    assert.equal((await POST(request({ nightId: 5 }, 'Bearer wrong'))).status, 401);
  });

  await test('POST — a malformed nightId is rejected (400)', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    installFixture();
    for (const nightId of ['abc', 1.5, 0, -1, true, [5], undefined]) {
      assert.equal((await POST(request({ nightId }, 'Bearer test-cron-secret'))).status, 400);
    }
  });

  await test('POST — an idle-ended night is synced to its final state', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    const db = installFixture();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => ({ ok: true, status: 200, json: async () => ({ id: 'night' }) }) as unknown as Response) as typeof fetch;
    const res = await POST(request({ nightId: 5 }, 'Bearer test-cron-secret'));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.ok(db.scrim_night_discord_state[0].finalized_at);
    delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  });

  report();
}

await main();
