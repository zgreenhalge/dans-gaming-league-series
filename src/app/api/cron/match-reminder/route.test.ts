/**
 * Route-handler harness for POST /api/cron/match-reminder — exercises the CRON_SECRET bearer gate
 * (same convention as GET /api/cron/refresh-steam) and the matchId body validation. Deeper
 * eligibility/idempotency behavior is covered by notifyMatchReminder()'s own tests
 * (src/lib/discord-notify.test.ts) — this file's job is proving the HTTP wiring actually calls it.
 *
 * Run:  npx vitest run "src/app/api/cron/match-reminder/route.test.ts"
 */

import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { __setTestClient } from '@/lib/supabase';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { buildFakeDb } from '@/lib/test-support/fixtures';
import { test, report } from '@/lib/test-support/miniTest';
import { POST } from './route';

const URL = 'http://localhost/api/cron/match-reminder';

function request(body: unknown, auth?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth !== undefined) headers.authorization = auth;
  return new NextRequest(URL, { method: 'POST', headers, body: JSON.stringify(body) });
}

/** notifyMatchReminder() reads through both the admin client the route passes it explicitly and the
 * module-level anon `supabase` singleton getMatchMeta() uses internally — both need to point at the
 * same fake DB. */
function installFixture(db: FakeDb): void {
  const client = createFakeSupabaseClient(db);
  __setTestClient(client);
  __setTestAdminClient(client);
}

/** Returns the (live, mutated-in-place) array `fetch` calls are recorded into — an object wrapping a
 * primitive counter wouldn't reflect later increments once destructured by a caller. */
function stubFetch(): { calls: unknown[] } {
  const calls: unknown[] = [];
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
    calls.push(null);
    return { ok: true, status: 200, json: async () => ({ id: 'stub-msg' }) } as unknown as Response;
  }) as typeof fetch;
  return { calls };
}

// process.env.CRON_SECRET is set fresh inside each test that needs valid auth, not once here —
// vitest's test() defers execution to a later run phase, so main()'s own top-level code (including
// any cleanup at the bottom) finishes running, during collection, before any test callback actually
// executes; the same reason discord-notify.test.ts sets its env vars inside each test body.
async function main() {
  await test('POST — missing Authorization header is rejected (401)', async () => {
    installFixture(buildFakeDb());
    const res = await POST(request({ matchId: 101 }));
    assert.equal(res.status, 401);
  });

  await test('POST — wrong bearer token is rejected (401)', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    installFixture(buildFakeDb());
    const res = await POST(request({ matchId: 101 }, 'Bearer wrong-secret'));
    assert.equal(res.status, 401);
  });

  await test('POST — non-numeric matchId is rejected (400)', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    installFixture(buildFakeDb());
    const res = await POST(request({ matchId: 'abc' }, 'Bearer test-cron-secret'));
    assert.equal(res.status, 400);
  });

  await test('POST — missing matchId is rejected (400)', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    installFixture(buildFakeDb());
    const res = await POST(request({}, 'Bearer test-cron-secret'));
    assert.equal(res.status, 400);
  });

  await test('POST — valid auth + an eligible match invokes notifyMatchReminder() and posts to Discord', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    const db = buildFakeDb();
    const match = db.matches.find((m) => m.id === 101);
    if (match) match.scheduled_at = new Date(Date.now() + 55 * 60 * 1000).toISOString();
    installFixture(db);
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    const { calls } = stubFetch();

    const res = await POST(request({ matchId: 101 }, 'Bearer test-cron-secret'));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.clone().json(), { ok: true });
    assert.equal(calls.length, 1, 'notifyMatchReminder() actually ran and posted');

    delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  });

  await test('POST — always 200s even when the notification itself no-ops (e.g. an ineligible match)', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    installFixture(buildFakeDb()); // match 100's scheduled_at is null
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    const { calls } = stubFetch();

    const res = await POST(request({ matchId: 100 }, 'Bearer test-cron-secret'));
    assert.equal(res.status, 200, 'a one-shot pg_net caller has nothing to retry — failures/no-ops go to ops_errors, not a non-200');
    assert.equal(calls.length, 0);

    delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  });

  delete process.env.CRON_SECRET;
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
