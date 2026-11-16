/**
 * Route-handler harness for POST /api/cron/scrim-reminder — the CRON_SECRET bearer gate and the
 * nightId body validation, plus that an eligible night reaches notifyScrimNightReminder() and the
 * route still 200s when the notification no-ops. Eligibility and idempotency are covered by
 * src/lib/discord-scrim-notify.test.ts.
 *
 * Run:  npx vitest run "src/app/api/cron/scrim-reminder/route.test.ts"
 */

import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { scrimNightStartingIn } from '@/lib/test-support/scrimFixtures';
import { test, report } from '@/lib/test-support/miniTest';
import { POST } from './route';

const URL = 'http://localhost/api/cron/scrim-reminder';

function request(body: unknown, auth?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth !== undefined) headers.authorization = auth;
  return new NextRequest(URL, { method: 'POST', headers, body: JSON.stringify(body) });
}

function installFixture(startsInMs: number): void {
  const db: FakeDb = {
    players: [{ id: 1, name: 'Ann', discord_name_role_id: null }],
    scrim_nights: [scrimNightStartingIn(startsInMs, 5)],
    scrim_signups: [{ id: 1, night_id: 5, player_id: 1, commitment: 'definite', signed_up_at: '2026-01-01T00:00:00Z', checked_in_at: null }],
    scrim_night_discord_state: [],
  };
  __setTestAdminClient(createFakeSupabaseClient(db));
}

function stubFetch(): { calls: number } {
  const counter = { calls: 0 };
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
    counter.calls++;
    return { ok: true, status: 200, json: async () => ({ id: 'stub-msg' }) } as unknown as Response;
  }) as typeof fetch;
  return counter;
}

// Env vars are set inside each test body: vitest defers test callbacks until after main() returns.
async function main() {
  await test('POST — a missing or wrong bearer token is rejected (401)', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    installFixture(55 * 60 * 1000);
    assert.equal((await POST(request({ nightId: 5 }))).status, 401);
    assert.equal((await POST(request({ nightId: 5 }, 'Bearer wrong'))).status, 401);
  });

  await test('POST — a malformed nightId is rejected (400)', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    installFixture(55 * 60 * 1000);
    for (const nightId of ['abc', 1.5, 0, -1, true, [5], undefined]) {
      assert.equal((await POST(request({ nightId }, 'Bearer test-cron-secret'))).status, 400);
    }
  });

  await test('POST — an eligible night posts the reminder', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    installFixture(55 * 60 * 1000);
    const fetched = stubFetch();
    const res = await POST(request({ nightId: 5 }, 'Bearer test-cron-secret'));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(fetched.calls, 1);
    delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  });

  await test('POST — still 200s when the notification no-ops (a night too far out)', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    installFixture(10 * 60 * 60 * 1000);
    const fetched = stubFetch();
    assert.equal((await POST(request({ nightId: 5 }, 'Bearer test-cron-secret'))).status, 200);
    assert.equal(fetched.calls, 0);
    delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  });

  report();
}

await main();
