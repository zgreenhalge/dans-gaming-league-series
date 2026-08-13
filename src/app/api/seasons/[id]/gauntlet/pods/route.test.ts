/**
 * Route-handler harness for POST /api/seasons/[id]/gauntlet/pods (#379) — exercises
 * requireAdminAccess()'s 401/403 branches, the route's own pod/slot body validation, and
 * saveManualDraft()'s not-eligible/invalid/saved outcomes through the exported handler directly.
 *
 * saveManualDraft() calls the `reconcile_gauntlet_draft` RPC, which has no generic fake
 * implementation (see fakeSupabase.ts's header comment) — this reuses the same test-local fake
 * implementation gauntlet-engine.test.ts built, registered via createFakeSupabaseClient()'s
 * rpcHandlers argument.
 *
 * Run:  npx tsx "src/app/api/seasons/[id]/gauntlet/pods/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestClient } from '@/lib/supabase';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb, type RpcHandler } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { POST } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const SEASON_ID = 10;

type PodRef = { kind: 'id' | 'temp'; value: number | string };
type RpcSlot = {
  pod_ref: PodRef;
  slot_index: number;
  source_kind: 'seed' | 'pod';
  source_seed: number | null;
  source_pod_ref: PodRef | null;
  player_id: number | null;
};

/** Mirrors the real Postgres reconcile_gauntlet_draft() function closely enough for
 * saveManualDraft()'s call shape — see gauntlet-engine.test.ts, which documents the behavior this
 * duplicates (delete/insert/update/slot-rewrite, skipping any target pod that raced to materialized). */
function makeReconcileGauntletDraftRpc(): RpcHandler {
  return (args, db) => {
    const pods = (db.gauntlet_pods ??= []);
    const slots = (db.gauntlet_pod_slots ??= []);

    const deletePodIds = args.p_delete_pod_ids as number[];
    const newPods = args.p_new_pods as { temp_key: string; season_id: number; round_number: number; pod_index: number; advance_rule: string; is_final: boolean }[];
    const updatedPods = args.p_updated_pods as { id: number; advance_rule: string; is_final: boolean }[];
    const rewritePodIds = args.p_slot_rewrite_pod_ids as number[];
    const submittedSlots = args.p_slots as RpcSlot[];

    const isMaterialized = (id: number) => pods.find((p) => p.id === id)?.match1_id != null;
    const skipped = new Set<number>();
    for (const id of deletePodIds) if (isMaterialized(id)) skipped.add(id);
    for (const id of rewritePodIds) if (isMaterialized(id)) skipped.add(id);

    const toActuallyDelete = deletePodIds.filter((id) => !skipped.has(id));
    db.gauntlet_pod_slots = slots.filter((s) => !toActuallyDelete.includes(s.pod_id as number));
    db.gauntlet_pods = pods.filter((p) => !toActuallyDelete.includes(p.id as number));

    for (const u of updatedPods) {
      if (skipped.has(u.id)) continue;
      const pod = db.gauntlet_pods.find((p) => p.id === u.id);
      if (pod) {
        pod.advance_rule = u.advance_rule;
        pod.is_final = u.is_final;
      }
    }

    const keyMap: Record<string, number> = {};
    let nextPodId = 1 + Math.max(0, ...db.gauntlet_pods.map((p) => (typeof p.id === 'number' ? p.id : 0)));
    for (const np of newPods) {
      const id = nextPodId++;
      db.gauntlet_pods.push({ id, season_id: np.season_id, round_number: np.round_number, pod_index: np.pod_index, advance_rule: np.advance_rule, is_final: np.is_final, week_id: null, match1_id: null, match2_id: null });
      keyMap[np.temp_key] = id;
    }

    const resolveRef = (ref: PodRef): number => (ref.kind === 'id' ? Number(ref.value) : keyMap[ref.value as string]);
    const rewriteTargets = new Set<number>([...newPods.map((np) => keyMap[np.temp_key]), ...rewritePodIds.filter((id) => !skipped.has(id))]);
    db.gauntlet_pod_slots = db.gauntlet_pod_slots.filter((s) => !rewriteTargets.has(s.pod_id as number));

    let nextSlotId = 1 + Math.max(0, ...db.gauntlet_pod_slots.map((s) => (typeof s.id === 'number' ? s.id : 0)));
    for (const slot of submittedSlots) {
      const podId = resolveRef(slot.pod_ref);
      if (!rewriteTargets.has(podId)) continue;
      db.gauntlet_pod_slots.push({
        id: nextSlotId++,
        pod_id: podId,
        slot_index: slot.slot_index,
        source_kind: slot.source_kind,
        source_seed: slot.source_seed,
        source_pod_id: slot.source_pod_ref ? resolveRef(slot.source_pod_ref) : null,
        player_id: slot.player_id,
      });
    }

    return { key_map: keyMap, skipped_pod_ids: [...skipped] };
  };
}

function makeDb(): FakeDb {
  return {
    players: [
      { id: ADMIN_ID, is_admin: true, name: 'Admin' },
      { id: PLAYER_ID, is_admin: false, name: 'Player 2' },
      { id: 3, is_admin: false, name: 'Player 3' },
      { id: 4, is_admin: false, name: 'Player 4' },
    ],
    seasons: [{ id: SEASON_ID, name: 'Season 40', status: 'COMPLETED', is_gauntlet: false, target_win_rounds: 13 }],
    player_season_leaderboard: [1, 2, 3, 4].map((id, i) => ({ season_id: SEASON_ID, player_id: id, player_name: `Player ${id}`, win_rate_percentage: 100 - i * 10 })),
    gauntlet_pods: [],
    gauntlet_pod_slots: [],
    ops_errors: [],
  };
}

function installFixture(): FakeDb {
  const db = makeDb();
  const client = createFakeSupabaseClient(db, { reconcile_gauntlet_draft: makeReconcileGauntletDraftRpc() });
  __setTestClient(client);
  __setTestAdminClient(client);
  return db;
}

const url = (seasonId: number | string) => `http://localhost/api/seasons/${seasonId}/gauntlet/pods`;

function call(seasonId: number | string, sessionPlayerId: number | null, body: unknown) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return POST(jsonRequest(url(seasonId), 'POST', body), { params: Promise.resolve({ id: String(seasonId) }) });
}

const validPod = (overrides: Record<string, unknown> = {}) => ({
  key: 'r1',
  persistedId: null,
  advance_rule: 'single',
  is_final: false,
  round_number: 1,
  pod_index: 0,
  slots: [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 2 }, { kind: 'seed', seed: 3 }, { kind: 'seed', seed: 4 }],
  ...overrides,
});

async function main() {
  await test('POST — unauthenticated request is rejected (401)', async () => {
    installFixture();
    assert.equal((await call(SEASON_ID, null, { pods: [] })).status, 401);
  });

  await test('POST — non-admin is rejected (403)', async () => {
    installFixture();
    assert.equal((await call(SEASON_ID, PLAYER_ID, { pods: [] })).status, 403);
  });

  await test('POST — non-numeric season id is rejected (400)', async () => {
    installFixture();
    assert.equal((await call('abc', ADMIN_ID, { pods: [] })).status, 400);
  });

  await test('POST — an invalid start_date format is rejected (400)', async () => {
    installFixture();
    const res = await call(SEASON_ID, ADMIN_ID, { start_date: '01/01/2026', pods: [] });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Invalid date format (expected YYYY-MM-DD)');
  });

  await test('POST — a non-array pods field is rejected (400)', async () => {
    installFixture();
    const res = await call(SEASON_ID, ADMIN_ID, { pods: 'nope' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'pods must be an array');
  });

  await test('POST — a malformed pod is rejected (400)', async () => {
    installFixture();
    const res = await call(SEASON_ID, ADMIN_ID, { pods: [{ key: 'a' }] });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'One or more pods are malformed');
  });

  await test('POST — a malformed slot (bad seed number) is rejected (400)', async () => {
    installFixture();
    const res = await call(SEASON_ID, ADMIN_ID, { pods: [validPod({ slots: [{ kind: 'seed', seed: 0 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] })] });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'One or more pods are malformed');
  });

  await test('POST — an integrity violation (two Finals) is rejected (400)', async () => {
    installFixture();
    const res = await call(SEASON_ID, ADMIN_ID, {
      pods: [validPod({ key: 'a', is_final: true }), validPod({ key: 'b', is_final: true })],
    });
    assert.equal(res.status, 400);
  });

  await test('POST — admin saves a new manual draft, creating the gauntlet season and materializing a fully-seeded pod (200)', async () => {
    const db = installFixture();
    const pods = [
      validPod({ key: 'r1' }),
      validPod({
        key: 'final',
        round_number: 2,
        is_final: true,
        slots: [{ kind: 'advance', sourcePodKey: 'r1', ordinal: 0 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }],
      }),
    ];
    const res = await call(SEASON_ID, ADMIN_ID, { pods, start_date: '2026-05-01' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.gauntletSeasonId === 'number');

    const gauntletSeason = db.seasons.find((s) => s.id === body.gauntletSeasonId)!;
    assert.equal(gauntletSeason.name, 'Season 40 Gauntlet');
    assert.equal(gauntletSeason.start_date, '2026-05-01');

    const r1 = db.gauntlet_pods.find((p) => p.round_number === 1)!;
    assert.ok(r1.match1_id != null, 'r1 should have materialized once fully seeded');
  });

  await test('POST — a season not found is rejected (404)', async () => {
    installFixture();
    const res = await call(999, ADMIN_ID, { pods: [validPod()] });
    assert.equal(res.status, 404);
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

main();
