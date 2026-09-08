/**
 * Route-handler harness for PATCH /api/matches/[id]/schedule — the admin-or-in-match access gate,
 * the gauntlet-pod scheduling rules (Game 1 only, Game 2 derived 30 minutes later), body validation,
 * and (#395) that a successful write always calls the `schedule_match_reminder` RPC afterward with
 * the right args, best-effort (an RPC failure doesn't fail the request, since scheduled_at itself
 * already committed).
 *
 * Run:  npx vitest run "src/app/api/matches/[id]/schedule/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestClient } from '@/lib/supabase';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { __setTestAfterMode, __flushTestAfter } from '@/lib/after';
import { createFakeSupabaseClient, type RpcHandler } from '@/lib/test-support/fakeSupabase';
import { buildFakeDb } from '@/lib/test-support/fixtures';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { PATCH } from './route';

const ADMIN_ID = 1;
const OUT_OF_MATCH_ID = 5;
const MATCH_ID = 100; // non-gauntlet
const GAUNTLET_MATCH_ID = 200; // pod 1000's Game 1 (match1_id) in the base fixture
const GAUNTLET_MATCH_ID_2 = 201; // Game 2, added by installPodFixture() below

function installFixture(rpcHandlers: Record<string, RpcHandler> = {}) {
  const db = buildFakeDb();
  const client = createFakeSupabaseClient(db, rpcHandlers);
  // The route reads its gauntlet-pod lookup through the query layer's anon `supabase` singleton
  // (getGauntletPodForMatch()), same as every other read-only query helper, while writing through
  // the admin client — both need to point at the same fake db.
  __setTestClient(client);
  __setTestAdminClient(client);
  return db;
}

/** installFixture() plus a second materialized match completing GAUNTLET_MATCH_ID's pod — the base
 * fixture's pod 1000 only carries `match1_id` (it exists for other tests that don't need a full pod
 * pair), so the Game-1/Game-2 scheduling tests build the real two-match shape here instead of
 * touching the shared fixture. */
function installPodFixture(rpcHandlers: Record<string, RpcHandler> = {}) {
  const db = installFixture(rpcHandlers);
  db.matches.push({
    id: GAUNTLET_MATCH_ID_2, week_id: 12, match_number: 2, final_score: null,
    picked_map: null, shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null,
    shirts_pick: null, skins_starting_side: null, is_playoff_game: true, is_feature_match: false,
    pre_match_win_prob: null, pre_match_win_prob_formula_version: null, scheduled_at: null,
    round_history: null, recording_url: null, replay_status: 'none',
  });
  // Replace, don't mutate, the pod row — buildFakeDb() returns the same shared fixture row objects
  // every call, so mutating one in place would leak into every other test that touches this fixture.
  db.gauntlet_pods = db.gauntlet_pods.map((p) =>
    p.match1_id === GAUNTLET_MATCH_ID ? { ...p, match2_id: GAUNTLET_MATCH_ID_2 } : p,
  );
  return db;
}

const url = (matchId: number | string) => `http://localhost/api/matches/${matchId}/schedule`;

function call(matchId: number | string, sessionPlayerId: number | null, body: unknown) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return PATCH(jsonRequest(url(matchId), 'PATCH', body), { params: Promise.resolve({ id: String(matchId) }) });
}

/** Records every call into the returned array and reports success (`true`), matching the real
 * `schedule_match_reminder()`'s Postgres return shape for the "fully scheduled" case — this file
 * only needs to prove the route calls it with the right args and reacts correctly to its return
 * value, not re-implement its scheduling logic (see supabase/migrations for the real one). */
function recordingRpc(): { calls: Record<string, unknown>[]; handler: RpcHandler } {
  const calls: Record<string, unknown>[] = [];
  return { calls, handler: (args) => { calls.push(args); return true; } };
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

  await test('PATCH — a gauntlet match with no fully materialized pod is rejected (404)', async () => {
    // Base fixture's pod 1000 only has match1_id set — a transient state in production, between
    // materializePod()'s two match inserts, that's never actually schedulable.
    installFixture();
    const res = await call(GAUNTLET_MATCH_ID, ADMIN_ID, { scheduled_at: null });
    assert.equal(res.status, 404);
  });

  await test('PATCH — scheduling a pod\'s Game 2 directly is rejected (400), pointing at Game 1', async () => {
    installPodFixture();
    const res = await call(GAUNTLET_MATCH_ID_2, ADMIN_ID, { scheduled_at: '2026-09-01T18:00:00.000Z' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Game 1/);
  });

  await test('PATCH — scheduling a pod\'s Game 1 also sets Game 2 thirty minutes later, and reminds only Game 1', async () => {
    __setTestAfterMode(true);
    const { calls, handler } = recordingRpc();
    const db = installPodFixture({ schedule_match_reminder: handler });
    const iso = '2026-09-01T18:00:00.000Z';

    const res = await call(GAUNTLET_MATCH_ID, ADMIN_ID, { scheduled_at: iso });
    assert.equal(res.status, 200);
    assert.equal(db.matches.find((m) => m.id === GAUNTLET_MATCH_ID)?.scheduled_at, iso);
    assert.equal(db.matches.find((m) => m.id === GAUNTLET_MATCH_ID_2)?.scheduled_at, '2026-09-01T18:30:00.000Z');

    await __flushTestAfter();
    assert.equal(calls.length, 1, 'only Game 1 gets a reminder scheduled — one per pod, not two');
    assert.deepEqual(calls[0], { p_match_id: GAUNTLET_MATCH_ID, p_scheduled_at: iso });
    __setTestAfterMode(false);
  });

  await test('PATCH — clearing a pod\'s Game 1 time also clears Game 2\'s', async () => {
    __setTestAfterMode(true);
    const db = installPodFixture({ schedule_match_reminder: () => true });
    db.matches.find((m) => m.id === GAUNTLET_MATCH_ID)!.scheduled_at = '2026-09-01T18:00:00.000Z';
    db.matches.find((m) => m.id === GAUNTLET_MATCH_ID_2)!.scheduled_at = '2026-09-01T18:30:00.000Z';

    const res = await call(GAUNTLET_MATCH_ID, ADMIN_ID, { scheduled_at: null });
    assert.equal(res.status, 200);
    assert.equal(db.matches.find((m) => m.id === GAUNTLET_MATCH_ID)?.scheduled_at, null);
    assert.equal(db.matches.find((m) => m.id === GAUNTLET_MATCH_ID_2)?.scheduled_at, null);
    await __flushTestAfter();
    __setTestAfterMode(false);
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
    __setTestAfterMode(true);
    const { calls, handler } = recordingRpc();
    const db = installFixture({ schedule_match_reminder: handler });
    const iso = '2026-09-01T18:00:00.000Z';

    const res = await call(MATCH_ID, ADMIN_ID, { scheduled_at: iso });
    assert.equal(res.status, 200);
    assert.equal(db.matches.find((m) => m.id === MATCH_ID)?.scheduled_at, iso);

    await __flushTestAfter();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { p_match_id: MATCH_ID, p_scheduled_at: iso });
    __setTestAfterMode(false);
  });

  await test('PATCH — clearing scheduled_at (null) also calls schedule_match_reminder, with null', async () => {
    __setTestAfterMode(true);
    const { calls, handler } = recordingRpc();
    const db = installFixture({ schedule_match_reminder: handler });
    db.matches.find((m) => m.id === MATCH_ID)!.scheduled_at = '2026-09-01T18:00:00.000Z';

    const res = await call(MATCH_ID, ADMIN_ID, { scheduled_at: null });
    assert.equal(res.status, 200);
    assert.equal(db.matches.find((m) => m.id === MATCH_ID)?.scheduled_at, null);

    await __flushTestAfter();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { p_match_id: MATCH_ID, p_scheduled_at: null });
    __setTestAfterMode(false);
  });

  await test('PATCH — an RPC failure is best-effort: the request still succeeds and it\'s recorded to ops_errors under its own operation key', async () => {
    __setTestAfterMode(true);
    const db = installFixture({
      schedule_match_reminder: () => {
        throw new Error('vault secret missing');
      },
    });

    const res = await call(MATCH_ID, ADMIN_ID, { scheduled_at: '2026-09-01T18:00:00.000Z' });
    assert.equal(res.status, 200, 'scheduled_at already committed — an RPC failure must not fail the request');

    await __flushTestAfter();
    assert.ok(
      db.ops_errors.some((e) => e.entity_type === 'match' && e.entity_id === MATCH_ID && e.operation === 'discord_schedule_reminder'),
      'the failure is still visible in the admin console\'s Activity feed',
    );
    __setTestAfterMode(false);
  });

  await test('PATCH — a successful reschedule clears a prior scheduling failure for the same match', async () => {
    __setTestAfterMode(true);
    const db = installFixture({ schedule_match_reminder: () => true });
    db.ops_errors.push({
      id: 1, entity_type: 'match', entity_id: MATCH_ID, operation: 'discord_schedule_reminder',
      message: 'Failed to schedule reminder: vault secret missing', occurred_at: new Date().toISOString(), dismissed_at: null,
    });

    await call(MATCH_ID, ADMIN_ID, { scheduled_at: '2026-09-01T18:00:00.000Z' });
    await __flushTestAfter();

    assert.ok(
      !db.ops_errors.some((e) => e.entity_type === 'match' && e.entity_id === MATCH_ID && e.operation === 'discord_schedule_reminder' && e.dismissed_at === null),
      'the earlier scheduling failure no longer shows as live once scheduling succeeds',
    );
    __setTestAfterMode(false);
  });

  await test('PATCH — schedule_match_reminder() reporting false (e.g. Vault secret missing) does not clear the error it just recorded itself', async () => {
    __setTestAfterMode(true);
    // Mirrors the real function: records its own specific ops_errors row, then reports false —
    // the route must not treat "the RPC call didn't throw" as "scheduling succeeded".
    const db = installFixture({
      schedule_match_reminder: (_args, fakeDb) => {
        (fakeDb.ops_errors ??= []).push({
          id: 1, entity_type: 'match', entity_id: MATCH_ID, operation: 'discord_schedule_reminder',
          message: 'Vault secret "cron_secret" is not configured — cannot schedule match reminder',
          occurred_at: new Date().toISOString(), dismissed_at: null,
        });
        return false;
      },
    });

    const res = await call(MATCH_ID, ADMIN_ID, { scheduled_at: '2026-09-01T18:00:00.000Z' });
    assert.equal(res.status, 200);

    await __flushTestAfter();
    assert.ok(
      db.ops_errors.some((e) => e.entity_type === 'match' && e.entity_id === MATCH_ID && e.operation === 'discord_schedule_reminder' && e.dismissed_at === null),
      'the Vault-secret-missing error is still live — the route must not have cleared it',
    );
    __setTestAfterMode(false);
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
