/**
 * Pure, DB-free model for the manual gauntlet pod editor. A `DraftPod[]` is the client-side working
 * copy the admin edits — round/pod/slot structure mirrors `gauntlet_pods`/`gauntlet_pod_slots`
 * exactly (see `getGauntletBracketShape()` in `queries.ts`), but every pod carries a stable `key`
 * (not yet a real id for a brand-new pod) and every slot is either still empty, a directly-picked
 * player, or an as-yet-unresolved reference to an earlier pod's Nth survivor. Nothing here talks to
 * the database — `saveManualDraft()` in `gauntlet-engine.ts` is the only place a `DraftPod[]` gets
 * reconciled into real rows.
 */

import type { BracketPlan, AdvanceRule } from './gauntlet-bracket';
import type { BracketPod } from './queries';

export type { AdvanceRule };

export type DraftSlot =
  | { kind: 'empty' }
  | { kind: 'player'; playerId: number }
  | { kind: 'advance'; sourcePodKey: string; ordinal: number };

export interface DraftPod {
  /** Stable client-side identity. A persisted pod uses `String(persistedId)`; a brand-new pod gets
   * one minted at "Add Pod" time (e.g. a counter or `crypto.randomUUID()`) — never recomputed from
   * round/pod_index, so reordering or editing a pod never invalidates anything that references it. */
  key: string;
  persistedId: number | null;
  /** True once this pod's matches already exist (`match1_id` set) — read-only in the editor. */
  materialized: boolean;
  round_number: number;
  pod_index: number;
  advance_rule: AdvanceRule;
  is_final: boolean;
  /** Always length 4. */
  slots: DraftSlot[];
}

/** How many survivors a pod sends downstream — the "elimination scale" the editor exposes per pod. */
export function capacityFor(rule: AdvanceRule): number {
  return rule === 'single' ? 1 : 3;
}

export function emptyDraftPod(key: string, round_number: number, pod_index: number): DraftPod {
  return {
    key,
    persistedId: null,
    materialized: false,
    round_number,
    pod_index,
    advance_rule: 'wildcard',
    is_final: false,
    slots: [{ kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }],
  };
}

/** Human name for a pod, shared by the diagram and the editor's slot picker so both read
 * "Winner of Round 1 Group 1" / "Second of Round 1 Group 2" identically. Groups are 1-indexed for
 * display; `pod_index` is 0-indexed. */
export function groupLabel(pod: { round_number: number; pod_index: number; is_final: boolean }): string {
  return pod.is_final ? 'the Final' : `Round ${pod.round_number} Group ${pod.pod_index + 1}`;
}

const ORDINALS = ['First', 'Second', 'Third', 'Fourth'];
export function ordinalWord(n: number): string {
  return ORDINALS[n] ?? `${n + 1}th`;
}

/** Derives a stable 0-based ordinal for every pod-sourced slot among all slots fed by the same
 * source pod, in (round_number, pod_index, slot_index) order — the same derivation
 * `GauntletBracketDiagram` uses for display labels, shared here so a freshly-loaded persisted shape
 * (which has no stored ordinal — the DB doesn't track "which survivor" a slot expects, only that
 * it's fed by a given source pod) gets the identical assignment. Keyed by `${consumingPodId}:${slot_index}`. */
export function computeAdvanceOrdinals(pods: BracketPod[]): Map<string, number> {
  const bySource = new Map<number, { podId: number; slotIndex: number }[]>();
  const ordered = [...pods].sort((a, b) => a.round_number - b.round_number || a.pod_index - b.pod_index);
  for (const pod of ordered) {
    for (const slot of pod.slots) {
      if (slot.source_kind === 'pod' && slot.source_pod_id != null) {
        const list = bySource.get(slot.source_pod_id) ?? [];
        list.push({ podId: pod.id, slotIndex: slot.slot_index });
        bySource.set(slot.source_pod_id, list);
      }
    }
  }
  const result = new Map<string, number>();
  for (const list of bySource.values()) {
    list.forEach((entry, i) => result.set(`${entry.podId}:${entry.slotIndex}`, i));
  }
  return result;
}

/** Loads an already-persisted bracket shape (a manual gauntlet already in progress, or one built by
 * the generator that the admin now wants to keep hand-editing) into the editor's draft form. */
export function fromPersistedShape(pods: BracketPod[]): DraftPod[] {
  const ordinals = computeAdvanceOrdinals(pods);
  return pods.map((pod) => ({
    key: String(pod.id),
    persistedId: pod.id,
    materialized: pod.materialized,
    round_number: pod.round_number,
    pod_index: pod.pod_index,
    advance_rule: pod.advance_rule,
    is_final: pod.is_final,
    slots: [...pod.slots]
      .sort((a, b) => a.slot_index - b.slot_index)
      .map((slot): DraftSlot => {
        if (slot.player_id != null) return { kind: 'player', playerId: slot.player_id };
        if (slot.source_kind === 'pod' && slot.source_pod_id != null) {
          const ordinal = ordinals.get(`${pod.id}:${slot.slot_index}`) ?? 0;
          return { kind: 'advance', sourcePodKey: String(slot.source_pod_id), ordinal };
        }
        return { kind: 'empty' };
      }),
  }));
}

/** Loads a fresh (not yet persisted) generated plan into the editor's draft form, resolving its
 * abstract seed numbers to real player ids via the season's current leaderboard order — the same
 * mapping `trySeedGauntlet()` uses at real seed time. This is the "switching from generated to
 * manual loads it as-is" path; the manual page calls this with the same `buildGauntletBracket(N)`
 * the generator's preview stage already computed, so the two are identical by construction. */
export function fromGeneratedPlan(plan: BracketPlan, leaderboard: { player_id: number }[]): DraftPod[] {
  const playerBySeed = new Map<number, number>();
  leaderboard.forEach((row, i) => playerBySeed.set(i + 1, row.player_id));
  const keyFor = (round: number, index: number) => `${round}:${index}`;

  const ordinalsBySource = new Map<string, number>();
  {
    const bySource = new Map<string, { round: number; index: number; slotIndex: number }[]>();
    const ordered = [...plan.pods].sort((a, b) => a.round_number - b.round_number || a.pod_index - b.pod_index);
    for (const pod of ordered) {
      for (const slot of pod.slots) {
        if (slot.source_kind === 'pod' && slot.source_round != null && slot.source_pod_index != null) {
          const sourceKey = keyFor(slot.source_round, slot.source_pod_index);
          const list = bySource.get(sourceKey) ?? [];
          list.push({ round: pod.round_number, index: pod.pod_index, slotIndex: slot.slot_index });
          bySource.set(sourceKey, list);
        }
      }
    }
    for (const [sourceKey, list] of bySource) {
      list.forEach((entry, i) => ordinalsBySource.set(`${sourceKey}:${keyFor(entry.round, entry.index)}:${entry.slotIndex}`, i));
    }
  }

  return plan.pods.map((pod) => ({
    key: keyFor(pod.round_number, pod.pod_index),
    persistedId: null,
    materialized: false,
    round_number: pod.round_number,
    pod_index: pod.pod_index,
    advance_rule: pod.advance_rule,
    is_final: pod.is_final,
    slots: [...pod.slots]
      .sort((a, b) => a.slot_index - b.slot_index)
      .map((slot): DraftSlot => {
        if (slot.source_kind === 'seed' && slot.source_seed != null) {
          const playerId = playerBySeed.get(slot.source_seed);
          return playerId != null ? { kind: 'player', playerId } : { kind: 'empty' };
        }
        if (slot.source_kind === 'pod' && slot.source_round != null && slot.source_pod_index != null) {
          const sourceKey = keyFor(slot.source_round, slot.source_pod_index);
          const consumerKey = keyFor(pod.round_number, pod.pod_index);
          const ordinal = ordinalsBySource.get(`${sourceKey}:${consumerKey}:${slot.slot_index}`) ?? 0;
          return { kind: 'advance', sourcePodKey: sourceKey, ordinal };
        }
        return { kind: 'empty' };
      }),
  }));
}

/** Re-derives every `advance` slot's validity after a local edit or delete — clears (`empty`) any
 * reference whose source pod no longer exists, whose ordinal exceeds its source's (possibly
 * just-shrunk) capacity, or that duplicates another slot's claim on the same source+ordinal (first
 * one in array order wins). Pure client-side array logic — nothing is persisted until Save, so
 * there's no DB-side cascade to run. */
export function pruneInvalidReferences(pods: DraftPod[]): DraftPod[] {
  const byKey = new Map(pods.map((p) => [p.key, p]));
  const claimedOrdinals = new Map<string, Set<number>>();

  return pods.map((pod) => ({
    ...pod,
    slots: pod.slots.map((slot): DraftSlot => {
      if (slot.kind !== 'advance') return slot;
      const source = byKey.get(slot.sourcePodKey);
      if (!source) return { kind: 'empty' };
      const capacity = capacityFor(source.advance_rule);
      if (slot.ordinal >= capacity) return { kind: 'empty' };
      const seen = claimedOrdinals.get(slot.sourcePodKey) ?? new Set<number>();
      if (seen.has(slot.ordinal)) return { kind: 'empty' };
      seen.add(slot.ordinal);
      claimedOrdinals.set(slot.sourcePodKey, seen);
      return slot;
    }),
  }));
}

/** Roster players not already placed in some `player` slot and not explicitly marked dropped. */
export function availablePlayers<P extends { id: number }>(pods: DraftPod[], roster: P[], droppedIds: Set<number>): P[] {
  const used = new Set<number>();
  for (const pod of pods) {
    for (const slot of pod.slots) {
      if (slot.kind === 'player') used.add(slot.playerId);
    }
  }
  return roster.filter((p) => !used.has(p.id) && !droppedIds.has(p.id));
}

export interface AdvancementOption {
  sourcePodKey: string;
  ordinal: number;
  label: string;
}

/** Every (source pod, ordinal) advancement not yet claimed by an existing `advance` slot anywhere
 * in the draft — the options a slot picker offers for "seed this slot from an earlier pod's
 * survivor" instead of a direct player pick. */
export function availableAdvancements(pods: DraftPod[]): AdvancementOption[] {
  const claimed = new Set<string>();
  for (const pod of pods) {
    for (const slot of pod.slots) {
      if (slot.kind === 'advance') claimed.add(`${slot.sourcePodKey}:${slot.ordinal}`);
    }
  }
  const options: AdvancementOption[] = [];
  for (const pod of pods) {
    if (pod.is_final) continue;
    const capacity = capacityFor(pod.advance_rule);
    for (let ordinal = 0; ordinal < capacity; ordinal++) {
      if (claimed.has(`${pod.key}:${ordinal}`)) continue;
      options.push({
        sourcePodKey: pod.key,
        ordinal,
        label: capacity === 1 ? `Winner of ${groupLabel(pod)}` : `${ordinalWord(ordinal)} of ${groupLabel(pod)}`,
      });
    }
  }
  return options;
}

export type IntegrityResult = { valid: true } | { valid: false; errors: string[] };

/** Hard rules — checked client-side to gate the Save button, and re-checked server-side
 * defensively. Violating any of these would corrupt `canonicalGauntletRankMap()` or
 * `resolveAndPropagate()`'s assumptions, so these always block, unlike `validateComplete()` below. */
export function validateIntegrity(pods: DraftPod[]): IntegrityResult {
  const errors = new Set<string>();

  const finals = pods.filter((p) => p.is_final);
  if (finals.length > 1) errors.add('Only one pod can be marked Final.');

  const playerUseCount = new Map<number, number>();
  for (const pod of pods) {
    for (const slot of pod.slots) {
      if (slot.kind === 'player') playerUseCount.set(slot.playerId, (playerUseCount.get(slot.playerId) ?? 0) + 1);
    }
  }
  if ([...playerUseCount.values()].some((n) => n > 1)) {
    errors.add('A player cannot be placed in more than one slot.');
  }

  const byKey = new Map(pods.map((p) => [p.key, p]));
  const seenOrdinals = new Map<string, Set<number>>();
  for (const pod of pods) {
    for (const slot of pod.slots) {
      if (slot.kind !== 'advance') continue;
      const source = byKey.get(slot.sourcePodKey);
      if (!source) {
        errors.add('A slot references a pod that no longer exists.');
        continue;
      }
      if (slot.ordinal >= capacityFor(source.advance_rule)) {
        errors.add(`A slot references an advancement beyond ${groupLabel(source)}'s capacity.`);
        continue;
      }
      const seen = seenOrdinals.get(slot.sourcePodKey) ?? new Set<number>();
      if (seen.has(slot.ordinal)) {
        errors.add(`${groupLabel(source)}'s ${ordinalWord(slot.ordinal)} advancement is claimed by more than one slot.`);
      }
      seen.add(slot.ordinal);
      seenOrdinals.set(slot.sourcePodKey, seen);
    }
  }

  return errors.size === 0 ? { valid: true } : { valid: false, errors: [...errors] };
}

export type CompleteResult = { complete: true } | { complete: false; issues: string[] };

/** Status-only — never blocks Save, since building a bracket round-by-round (round 2 undefined
 * until round 1 finishes) is the normal, expected way to use this editor. Drives a banner telling
 * the admin whether the bracket, as currently drafted, reduces every candidate to one Final. */
export function validateComplete(pods: DraftPod[]): CompleteResult {
  if (pods.length === 0) return { complete: false, issues: ['No pods yet.'] };
  const issues: string[] = [];

  const finals = pods.filter((p) => p.is_final);
  if (finals.length === 0) {
    issues.push('No pod is marked as the Final yet.');
  } else if (finals.length === 1) {
    const maxRound = Math.max(...pods.map((p) => p.round_number));
    if (finals[0].round_number !== maxRound) issues.push('The Final must be in the last round.');
    if (pods.filter((p) => p.round_number === maxRound).length > 1) {
      issues.push('The last round must contain only the Final.');
    }
  }

  const emptySlotCount = pods.reduce((n, p) => n + p.slots.filter((s) => s.kind === 'empty').length, 0);
  if (emptySlotCount > 0) {
    issues.push(`${emptySlotCount} slot${emptySlotCount === 1 ? '' : 's'} still unassigned.`);
  }

  const unclaimed = availableAdvancements(pods);
  if (unclaimed.length > 0) {
    issues.push(`${unclaimed.length} advancement${unclaimed.length === 1 ? '' : 's'} not yet routed anywhere.`);
  }

  return issues.length === 0 ? { complete: true } : { complete: false, issues };
}

/** Renders the current draft into the same shape `GauntletBracketDiagram` already knows how to
 * draw, so the editor gets a live preview for free. Unsaved pods get negative synthetic ids
 * (persisted ones already have real positive ids), kept unique within one draft only. */
export function draftToPreviewPods(pods: DraftPod[], playerNameById: Map<number, string>): BracketPod[] {
  const idByKey = new Map(pods.map((pod, i) => [pod.key, pod.persistedId ?? -(i + 1)]));
  return pods.map((pod) => ({
    id: idByKey.get(pod.key)!,
    round_number: pod.round_number,
    pod_index: pod.pod_index,
    advance_rule: pod.advance_rule,
    is_final: pod.is_final,
    played: false,
    materialized: pod.materialized,
    slots: pod.slots.map((slot, slot_index) => {
      if (slot.kind === 'player') {
        return {
          slot_index,
          source_kind: 'seed' as const,
          source_seed: null,
          source_pod_id: null,
          player_id: slot.playerId,
          player_name: playerNameById.get(slot.playerId) ?? null,
        };
      }
      if (slot.kind === 'advance') {
        return {
          slot_index,
          source_kind: 'pod' as const,
          source_seed: null,
          source_pod_id: idByKey.get(slot.sourcePodKey) ?? null,
          player_id: null,
          player_name: null,
        };
      }
      return {
        slot_index,
        source_kind: 'seed' as const,
        source_seed: null,
        source_pod_id: null,
        player_id: null,
        player_name: null,
      };
    }),
  }));
}
