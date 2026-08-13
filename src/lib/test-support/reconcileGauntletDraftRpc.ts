/**
 * A test-local fake for the `reconcile_gauntlet_draft` Postgres RPC — see fakeSupabase.ts's own
 * header comment on why `.rpc()` has no generic in-memory equivalent and needs a per-name fake
 * registered by the test that exercises it. Shared by every test that drives `saveManualDraft()`
 * (`gauntlet-engine.ts`) far enough to reach the RPC call: gauntlet-engine.test.ts and
 * seasons/[id]/gauntlet/pods/route.test.ts.
 */

import type { FakeDb, RpcHandler } from './fakeSupabase';

type PodRef = { kind: 'id' | 'temp'; value: number | string };
type RpcSlot = {
  pod_ref: PodRef;
  slot_index: number;
  source_kind: 'seed' | 'pod';
  source_seed: number | null;
  source_pod_ref: PodRef | null;
  player_id: number | null;
};

/** Mirrors the real Postgres function closely enough for saveManualDraft()'s call shape: deletes
 * removed pods, inserts new ones (minting real ids, returning a temp_key -> id map), updates
 * changed ones, and wholesale-replaces slots for every touched pod — skipping (and reporting) any
 * targeted pod that materialized (`match1_id` set) since the caller's initial read, exactly the race
 * `saveManualDraft()`'s doc comment describes. */
export function makeReconcileGauntletDraftRpc(): RpcHandler {
  return (args, db: FakeDb) => {
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
      db.gauntlet_pods.push({
        id,
        season_id: np.season_id,
        round_number: np.round_number,
        pod_index: np.pod_index,
        advance_rule: np.advance_rule,
        is_final: np.is_final,
        week_id: null,
        match1_id: null,
        match2_id: null,
      });
      keyMap[np.temp_key] = id;
    }

    const resolveRef = (ref: PodRef): number => (ref.kind === 'id' ? Number(ref.value) : keyMap[ref.value as string]);

    const rewriteTargets = new Set<number>([
      ...newPods.map((np) => keyMap[np.temp_key]),
      ...rewritePodIds.filter((id) => !skipped.has(id)),
    ]);
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
