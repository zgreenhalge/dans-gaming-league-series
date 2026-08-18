/**
 * Route-handler harness for PATCH /api/matches/[id]/schedule — the admin-or-in-match access gate,
 * the gauntlet-match rejection, body validation, and (#395) that a successful write always calls the
 * `schedule_match_reminder` RPC afterward with the right args, best-effort (an RPC failure doesn't
 * fail the request, since scheduled_at itself already committed).
 *
 * Run:  npx vitest run "src/app/api/matches/[id]/schedule/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type RpcHandler } from '@/lib/test-support/fakeSupabase';
import { buildFakeDb } from '@/lib/test-support/fixtures';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { PATCH } from './route';

const ADMIN_ID = 1;
const OUT_OF_MATCH_ID = 5;
const MATCH_ID = 100; // non-gauntlet
const GAUNTLET_MATCH_ID = 200;

function installFixture(rpcHandlers: Record<string, RpcHandler> = {}) {
  const db = buildFakeDb();
  const client = createFakeSupabaseClient(db, rpcHandlers);
  __setTestAdminClient(client);
  return db;
}

const url = (matchId: number | string) => `http://localhost/api/matches/${matchId}/schedule`;

function call(matchId: number | string, sessionPlayerId: number | null, body: unknown) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return PATCH(jsonRequest(url(matchId), 'PATCH', body), { params: Promise.resolve({ id: String(matchId) }) });
}

/** Records every call into the returned array — `schedule_match_reminder()`'s real implementation
 * is a Postgres function; this file only needs to prove the route calls it with the right args, not
 * re-implement its scheduling logic (see supabase/migrations for the real one). */
function recordingRpc(): { calls: Record<string, unknown>[]; handler: RpcHandler } {
  const calls: Record<string, unknown>[] = [];
  return { calls, handler: (args) => { calls.push(args); return null; } };
}

async function main() {
  await test('PATCH — non-numeric match id is rejected (400)', async () => {
    installFixture();
    const res = await call('abc', ADMIN_ID, { scheduled_at: null });
    assert.equal(res.status, 400);
  });

  await test('PATCH — unauthenticated request is rejected (401)', async () => {
    installFixture();
    const res = await call(MATCH_ID, null, { scheduled_at: null });
    assert.equal(res.status, 401);
  });

  await test('PATCH — a player outside the match and not admin is rejected (403)', async () => {
    installFixture();
    const res = await call(MATCH_ID, OUT_OF_MATCH_ID, { scheduled_at: null });
    assert.equal(res.status, 403);
  });

  await test('PATCH — gauntlet matches are rejected (403), even for an admin', async () => {
    installFixture();
    const res = await call(GAUNTLET_MATCH_ID, ADMIN_ID, { scheduled_at: null });
    assert.equal(res.status, 403);
  });

  await test('PATCH — missing scheduled_at in the body is rejected (400)', async () => {
    installFixture();
    const res = await call(MATCH_ID, ADMIN_ID, {});
    assert.equal(res.status, 400);
  });

  await test('PATCH — an invalid date string is rejected (400)', async () => {
    installFixture();
    const res = await call(MATCH_ID, ADMIN_ID, { scheduled_at: 'not-a-date' });
    assert.equal(res.status, 400);
  });

  await test('PATCH — schedules the match and calls schedule_match_reminder with the new time', async () => {
    const { calls, handler } = recordingRpc();
    const db = installFixture({ schedule_match_reminder: handler });
    const iso = '2026-09-01T18:00:00.000Z';

    const res = await call(MATCH_ID, ADMIN_ID, { scheduled_at: iso });
    assert.equal(res.status, 200);
    assert.equal(db.matches.find((m) => m.id === MATCH_ID)?.scheduled_at, iso);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { p_match_id: MATCH_ID, p_scheduled_at: iso });
  });

  await test('PATCH — clearing scheduled_at (null) also calls schedule_match_reminder, with null', async () => {
    const { calls, handler } = recordingRpc();
    const db = installFixture({ schedule_match_reminder: handler });
    db.matches.find((m) => m.id === MATCH_ID)!.scheduled_at = '2026-09-01T18:00:00.000Z';

    const res = await call(MATCH_ID, ADMIN_ID, { scheduled_at: null });
    assert.equal(res.status, 200);
    assert.equal(db.matches.find((m) => m.id === MATCH_ID)?.scheduled_at, null);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { p_match_id: MATCH_ID, p_scheduled_at: null });
  });

  await test('PATCH — an RPC failure is best-effort: the request still succeeds and it\'s recorded to ops_errors', async () => {
    const db = installFixture({
      schedule_match_reminder: () => {
        throw new Error('vault secret missing');
      },
    });

    const res = await call(MATCH_ID, ADMIN_ID, { scheduled_at: '2026-09-01T18:00:00.000Z' });
    assert.equal(res.status, 200, 'scheduled_at already committed — an RPC failure must not fail the request');
    assert.ok(
      db.ops_errors.some((e) => e.entity_type === 'match' && e.entity_id === MATCH_ID && e.operation === 'discord_notify_reminder'),
      'the failure is still visible in the admin console\'s Activity feed',
    );
  });

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
