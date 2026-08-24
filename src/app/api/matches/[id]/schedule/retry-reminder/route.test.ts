/**
 * Route-handler harness for POST /api/matches/[id]/schedule/retry-reminder — the admin-only gate,
 * match-id validation, and that it reads the match's *current* scheduled_at and forwards it verbatim
 * to schedule_match_reminder() (the same RPC PATCH /api/matches/[id]/schedule calls), reacting
 * correctly to a thrown RPC error the way scheduleMatchReminder() (discord-notify.ts) does.
 *
 * Run:  npx vitest run "src/app/api/matches/[id]/schedule/retry-reminder/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestClient } from '@/lib/supabase';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type RpcHandler } from '@/lib/test-support/fakeSupabase';
import { buildFakeDb } from '@/lib/test-support/fixtures';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { POST } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const SCHEDULED_MATCH_ID = 101; // scheduled_at: '2026-01-15T19:00:00.000Z' in fixtures
const UNSCHEDULED_MATCH_ID = 100; // scheduled_at: null in fixtures

function installFixture(rpcHandlers: Record<string, RpcHandler> = {}) {
  const db = buildFakeDb();
  const client = createFakeSupabaseClient(db, rpcHandlers);
  __setTestClient(client);
  __setTestAdminClient(client);
  return db;
}

const url = (matchId: number | string) => `http://localhost/api/matches/${matchId}/schedule/retry-reminder`;

function call(matchId: number | string, sessionPlayerId: number | null) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return POST(jsonRequest(url(matchId), 'POST'), { params: Promise.resolve({ id: String(matchId) }) });
}

function recordingRpc(): { calls: Record<string, unknown>[]; handler: RpcHandler } {
  const calls: Record<string, unknown>[] = [];
  return { calls, handler: (args) => { calls.push(args); return true; } };
}

async function main() {
  await test('POST — unauthenticated request is rejected (401)', async () => {
    installFixture();
    const res = await call(SCHEDULED_MATCH_ID, null);
    assert.equal(res.status, 401);
  });

  await test('POST — a non-admin is rejected (403)', async () => {
    installFixture();
    const res = await call(SCHEDULED_MATCH_ID, PLAYER_ID);
    assert.equal(res.status, 403);
  });

  await test('POST — a non-numeric match id is rejected (400)', async () => {
    installFixture();
    const res = await call('abc', ADMIN_ID);
    assert.equal(res.status, 400);
  });

  await test('POST — an unknown match id is rejected (404)', async () => {
    installFixture();
    const res = await call(999999, ADMIN_ID);
    assert.equal(res.status, 404);
  });

  await test('POST — retries scheduling with the match\'s current scheduled_at', async () => {
    const { calls, handler } = recordingRpc();
    installFixture({ schedule_match_reminder: handler });

    const res = await call(SCHEDULED_MATCH_ID, ADMIN_ID);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { p_match_id: SCHEDULED_MATCH_ID, p_scheduled_at: '2026-01-15T19:00:00.000Z' });
  });

  await test('POST — an unscheduled match still retries (with null), rather than being rejected', async () => {
    const { calls, handler } = recordingRpc();
    installFixture({ schedule_match_reminder: handler });

    const res = await call(UNSCHEDULED_MATCH_ID, ADMIN_ID);
    assert.equal(res.status, 200);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { p_match_id: UNSCHEDULED_MATCH_ID, p_scheduled_at: null });
  });

  await test('POST — an RPC failure still returns 200 (best-effort) and is recorded to ops_errors', async () => {
    const db = installFixture({
      schedule_match_reminder: () => {
        throw new Error('permission denied for schema cron');
      },
    });

    const res = await call(SCHEDULED_MATCH_ID, ADMIN_ID);
    assert.equal(res.status, 200);

    assert.ok(
      db.ops_errors.some((e) => e.entity_type === 'match' && e.entity_id === SCHEDULED_MATCH_ID && e.operation === 'discord_schedule_reminder' && e.dismissed_at === null),
      'the failure is recorded under discord_schedule_reminder for the admin to see',
    );
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
