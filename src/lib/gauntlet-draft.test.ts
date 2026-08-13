/**
 * Coverage for the pure, DB-free manual-pod-editor model — `fromPersistedShape()`/
 * `fromGeneratedPlan()` (loading into the editor), `pruneInvalidReferences()`/`validateIntegrity()`/
 * `validateComplete()` (the editor's local-edit and gate logic), `availableSeeds()`/
 * `availableAdvancements()` (slot-picker options), and `draftToPreviewPods()` (live diagram
 * preview). No DB fixture needed — everything here is a pure function of its arguments.
 *
 * Run:  npx tsx src/lib/gauntlet-draft.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import {
  capacityFor,
  emptyDraftPod,
  groupLabel,
  ordinalWord,
  computeAdvanceOrdinals,
  fromPersistedShape,
  fromGeneratedPlan,
  pruneInvalidReferences,
  availableSeeds,
  availableAdvancements,
  validateIntegrity,
  validateComplete,
  draftToPreviewPods,
  type DraftPod,
} from './gauntlet-draft';
import type { BracketPod } from './queries';
import type { BracketPlan } from './gauntlet-bracket';

// ─── capacityFor / groupLabel / ordinalWord ─────────────────────────────────

test('capacityFor: single advances 1, wildcard advances 3', () => {
  assert.equal(capacityFor('single'), 1);
  assert.equal(capacityFor('wildcard'), 3);
});

test('groupLabel: the Final vs Round N Group M (1-indexed display)', () => {
  assert.equal(groupLabel({ round_number: 1, pod_index: 0, is_final: true }), 'the Final');
  assert.equal(groupLabel({ round_number: 2, pod_index: 0, is_final: false }), 'Round 2 Group 1');
  assert.equal(groupLabel({ round_number: 1, pod_index: 2, is_final: false }), 'Round 1 Group 3');
});

test('ordinalWord: named ordinals 0-3, numeric fallback beyond', () => {
  assert.equal(ordinalWord(0), 'First');
  assert.equal(ordinalWord(1), 'Second');
  assert.equal(ordinalWord(2), 'Third');
  assert.equal(ordinalWord(3), 'Fourth');
  assert.equal(ordinalWord(4), '5th');
});

test('emptyDraftPod: fresh pod is wildcard, non-final, 4 empty slots', () => {
  const pod = emptyDraftPod('new-1', 2, 1);
  assert.deepEqual(pod, {
    key: 'new-1',
    persistedId: null,
    materialized: false,
    round_number: 2,
    pod_index: 1,
    advance_rule: 'wildcard',
    is_final: false,
    slots: [{ kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }],
  });
});

// ─── computeAdvanceOrdinals ──────────────────────────────────────────────────

function bracketPod(overrides: Partial<BracketPod> & { id: number }): BracketPod {
  return {
    round_number: 1,
    pod_index: 0,
    advance_rule: 'wildcard',
    is_final: false,
    played: false,
    materialized: false,
    slots: [],
    ...overrides,
  };
}

test('computeAdvanceOrdinals: assigns 0-based ordinals per source pod, in (round, pod_index, slot_index) order', () => {
  // Pod 10 (round 1) feeds two downstream slots: pod 20 slot 1 and pod 21 slot 0. Consumers are
  // visited in (round_number, pod_index) order regardless of slot_index within a pod.
  const pods: BracketPod[] = [
    bracketPod({ id: 10, round_number: 1, pod_index: 0 }),
    bracketPod({
      id: 20,
      round_number: 2,
      pod_index: 0,
      slots: [
        { slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: null, player_name: null },
        { slot_index: 1, source_kind: 'pod', source_seed: null, source_pod_id: 10, player_id: null, player_name: null },
      ],
    }),
    bracketPod({
      id: 21,
      round_number: 2,
      pod_index: 1,
      slots: [{ slot_index: 0, source_kind: 'pod', source_seed: null, source_pod_id: 10, player_id: null, player_name: null }],
    }),
  ];
  const ordinals = computeAdvanceOrdinals(pods);
  assert.equal(ordinals.get('20:1'), 0);
  assert.equal(ordinals.get('21:0'), 1);
});

// ─── fromPersistedShape ──────────────────────────────────────────────────────

test('fromPersistedShape: a seed slot with a player_id maps to kind seed', () => {
  const pods: BracketPod[] = [
    bracketPod({
      id: 1,
      slots: [{ slot_index: 0, source_kind: 'seed', source_seed: 3, source_pod_id: null, player_id: 42, player_name: 'Alice' }],
    }),
  ];
  const draft = fromPersistedShape(pods);
  assert.deepEqual(draft[0].slots[0], { kind: 'seed', seed: 3 });
});

test('fromPersistedShape: an unfilled seed slot (no player_id yet) maps to kind empty', () => {
  const pods: BracketPod[] = [
    bracketPod({
      id: 1,
      slots: [{ slot_index: 0, source_kind: 'seed', source_seed: 3, source_pod_id: null, player_id: null, player_name: null }],
    }),
  ];
  const draft = fromPersistedShape(pods);
  assert.deepEqual(draft[0].slots[0], { kind: 'empty' });
});

test('fromPersistedShape: a pod-sourced slot is read as advance even when player_id is already filled (resolveAndPropagate ran ahead of this pod materializing)', () => {
  const pods: BracketPod[] = [
    bracketPod({ id: 1, round_number: 1, pod_index: 0 }),
    bracketPod({
      id: 2,
      round_number: 2,
      pod_index: 0,
      slots: [{ slot_index: 0, source_kind: 'pod', source_seed: null, source_pod_id: 1, player_id: 99, player_name: 'Bob' }],
    }),
  ];
  const draft = fromPersistedShape(pods);
  const pod2 = draft.find((p) => p.key === '2')!;
  assert.deepEqual(pod2.slots[0], { kind: 'advance', sourcePodKey: '1', ordinal: 0 });
});

test('fromPersistedShape: materializedOccupants is set for a materialized pod and undefined otherwise', () => {
  const pods: BracketPod[] = [
    bracketPod({
      id: 1,
      materialized: true,
      slots: [
        { slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: 5, player_name: 'Carol' },
        { slot_index: 1, source_kind: 'seed', source_seed: 2, source_pod_id: null, player_id: null, player_name: null },
      ],
    }),
    bracketPod({ id: 2, materialized: false, slots: [] }),
  ];
  const draft = fromPersistedShape(pods);
  assert.deepEqual(draft[0].materializedOccupants, [{ playerId: 5, playerName: 'Carol' }, null]);
  assert.equal(draft[1].materializedOccupants, undefined);
});

test('fromPersistedShape: slots are sorted by slot_index regardless of input order', () => {
  const pods: BracketPod[] = [
    bracketPod({
      id: 1,
      slots: [
        { slot_index: 2, source_kind: 'seed', source_seed: 3, source_pod_id: null, player_id: 3, player_name: null },
        { slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: 1, player_name: null },
      ],
    }),
  ];
  const draft = fromPersistedShape(pods);
  assert.deepEqual(draft[0].slots, [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 3 }]);
});

// ─── fromGeneratedPlan ───────────────────────────────────────────────────────

test('fromGeneratedPlan: seed slots carry straight over, pod-sourced slots resolve to an advance with a computed ordinal', () => {
  const plan: BracketPlan = {
    games: 4,
    drops: [],
    pods: [
      { round_number: 1, pod_index: 0, advance_rule: 'wildcard', is_final: false, slots: [
        { slot_index: 0, source_kind: 'seed', source_seed: 1 },
        { slot_index: 1, source_kind: 'seed', source_seed: 2 },
      ] },
      { round_number: 2, pod_index: 0, advance_rule: 'single', is_final: true, slots: [
        { slot_index: 0, source_kind: 'pod', source_round: 1, source_pod_index: 0 },
      ] },
    ],
  };
  const draft = fromGeneratedPlan(plan);
  assert.equal(draft.length, 2);
  const r1 = draft.find((p) => p.key === '1:0')!;
  assert.deepEqual(r1.slots[0], { kind: 'seed', seed: 1 });
  assert.deepEqual(r1.slots[1], { kind: 'seed', seed: 2 });
  const final = draft.find((p) => p.key === '2:0')!;
  assert.deepEqual(final.slots[0], { kind: 'advance', sourcePodKey: '1:0', ordinal: 0 });
  assert.equal(final.persistedId, null);
  assert.equal(final.materialized, false);
});

test('fromGeneratedPlan: a slot with neither seed nor pod source data maps to empty', () => {
  const plan: BracketPlan = {
    games: 0,
    drops: [],
    pods: [{ round_number: 1, pod_index: 0, advance_rule: 'wildcard', is_final: false, slots: [{ slot_index: 0, source_kind: 'seed' }] }],
  };
  const draft = fromGeneratedPlan(plan);
  assert.deepEqual(draft[0].slots[0], { kind: 'empty' });
});

// ─── pruneInvalidReferences ──────────────────────────────────────────────────

function draftPod(overrides: Partial<DraftPod> & { key: string }): DraftPod {
  return {
    persistedId: null,
    materialized: false,
    round_number: 1,
    pod_index: 0,
    advance_rule: 'wildcard',
    is_final: false,
    slots: [{ kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }],
    ...overrides,
  };
}

test('pruneInvalidReferences: clears an advance slot whose source pod no longer exists', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'a', slots: [{ kind: 'advance', sourcePodKey: 'gone', ordinal: 0 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] }),
  ];
  const pruned = pruneInvalidReferences(pods);
  assert.deepEqual(pruned[0].slots[0], { kind: 'empty' });
});

test('pruneInvalidReferences: clears an advance slot whose ordinal exceeds the (possibly shrunk) source capacity', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'src', advance_rule: 'single' }), // capacity 1
    draftPod({ key: 'dst', slots: [{ kind: 'advance', sourcePodKey: 'src', ordinal: 2 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] }),
  ];
  const pruned = pruneInvalidReferences(pods);
  assert.deepEqual(pruned[1].slots[0], { kind: 'empty' });
});

test('pruneInvalidReferences: a valid, in-range advance slot survives untouched', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'src', advance_rule: 'wildcard' }), // capacity 3
    draftPod({ key: 'dst', slots: [{ kind: 'advance', sourcePodKey: 'src', ordinal: 2 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] }),
  ];
  const pruned = pruneInvalidReferences(pods);
  assert.deepEqual(pruned[1].slots[0], { kind: 'advance', sourcePodKey: 'src', ordinal: 2 });
});

test('pruneInvalidReferences: a duplicate (source, ordinal) claim keeps the first occurrence and clears the rest', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'src', advance_rule: 'single' }),
    draftPod({
      key: 'dst1',
      slots: [{ kind: 'advance', sourcePodKey: 'src', ordinal: 0 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }],
    }),
    draftPod({
      key: 'dst2',
      slots: [{ kind: 'advance', sourcePodKey: 'src', ordinal: 0 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }],
    }),
  ];
  const pruned = pruneInvalidReferences(pods);
  assert.deepEqual(pruned[1].slots[0], { kind: 'advance', sourcePodKey: 'src', ordinal: 0 });
  assert.deepEqual(pruned[2].slots[0], { kind: 'empty' });
});

// ─── availableSeeds ──────────────────────────────────────────────────────────

test('availableSeeds: excludes seeds already placed in a slot and seeds whose holder is dropped', () => {
  const roster = [{ id: 10 }, { id: 20 }, { id: 30 }, { id: 40 }]; // seeds 1-4
  const pods: DraftPod[] = [draftPod({ key: 'a', slots: [{ kind: 'seed', seed: 2 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] })];
  const seeds = availableSeeds(pods, roster, new Set([30])); // seed 3 (player 30) dropped
  assert.deepEqual(seeds, [1, 4]);
});

test('availableSeeds: with nothing placed and nobody dropped, every seed 1..roster.length is available', () => {
  const roster = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(availableSeeds([], roster, new Set()), [1, 2, 3]);
});

// ─── availableAdvancements ───────────────────────────────────────────────────

test('availableAdvancements: a wildcard pod offers 3 ordinals with First/Second/Third labels, minus any already claimed', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'src', round_number: 1, pod_index: 0, advance_rule: 'wildcard' }),
    draftPod({ key: 'dst', is_final: true, slots: [{ kind: 'advance', sourcePodKey: 'src', ordinal: 1 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] }),
  ];
  const options = availableAdvancements(pods);
  assert.deepEqual(options, [
    { sourcePodKey: 'src', ordinal: 0, label: 'First of Round 1 Group 1' },
    { sourcePodKey: 'src', ordinal: 2, label: 'Third of Round 1 Group 1' },
  ]);
});

test('availableAdvancements: a single-advance pod offers one "Winner of" option; a final pod offers none', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'src', round_number: 1, pod_index: 0, advance_rule: 'single' }),
    draftPod({ key: 'final', is_final: true, advance_rule: 'single' }),
  ];
  const options = availableAdvancements(pods);
  assert.deepEqual(options, [{ sourcePodKey: 'src', ordinal: 0, label: 'Winner of Round 1 Group 1' }]);
});

// ─── validateIntegrity ───────────────────────────────────────────────────────

test('validateIntegrity: more than one Final pod is an error', () => {
  const pods: DraftPod[] = [draftPod({ key: 'a', is_final: true }), draftPod({ key: 'b', is_final: true })];
  const result = validateIntegrity(pods);
  assert.equal(result.valid, false);
  assert.ok(!result.valid && result.errors.includes('Only one pod can be marked Final.'));
});

test('validateIntegrity: the same seed placed in two slots is an error', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'a', slots: [{ kind: 'seed', seed: 5 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] }),
    draftPod({ key: 'b', slots: [{ kind: 'seed', seed: 5 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] }),
  ];
  const result = validateIntegrity(pods);
  assert.equal(result.valid, false);
  assert.ok(!result.valid && result.errors.includes('A seed cannot be placed in more than one slot.'));
});

test('validateIntegrity: an advance slot referencing a nonexistent pod is an error', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'a', slots: [{ kind: 'advance', sourcePodKey: 'nope', ordinal: 0 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] }),
  ];
  const result = validateIntegrity(pods);
  assert.equal(result.valid, false);
  assert.ok(!result.valid && result.errors.includes('A slot references a pod that no longer exists.'));
});

test('validateIntegrity: an advance ordinal beyond the source pod\'s capacity is an error', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'src', round_number: 1, pod_index: 0, advance_rule: 'single' }),
    draftPod({ key: 'dst', slots: [{ kind: 'advance', sourcePodKey: 'src', ordinal: 1 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] }),
  ];
  const result = validateIntegrity(pods);
  assert.equal(result.valid, false);
  assert.ok(!result.valid && result.errors.includes("A slot references an advancement beyond Round 1 Group 1's capacity."));
});

test('validateIntegrity: two slots claiming the same (source, ordinal) advancement is an error', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'src', round_number: 1, pod_index: 0, advance_rule: 'wildcard' }),
    draftPod({ key: 'd1', slots: [{ kind: 'advance', sourcePodKey: 'src', ordinal: 0 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] }),
    draftPod({ key: 'd2', slots: [{ kind: 'advance', sourcePodKey: 'src', ordinal: 0 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] }),
  ];
  const result = validateIntegrity(pods);
  assert.equal(result.valid, false);
  assert.ok(!result.valid && result.errors.includes("Round 1 Group 1's First advancement is claimed by more than one slot."));
});

test('validateIntegrity: a well-formed draft is valid', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'src', round_number: 1, pod_index: 0, advance_rule: 'single', slots: [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 2 }, { kind: 'seed', seed: 3 }, { kind: 'seed', seed: 4 }] }),
    draftPod({ key: 'final', round_number: 2, pod_index: 0, is_final: true, slots: [{ kind: 'advance', sourcePodKey: 'src', ordinal: 0 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] }),
  ];
  assert.deepEqual(validateIntegrity(pods), { valid: true });
});

// ─── validateComplete ────────────────────────────────────────────────────────

test('validateComplete: no pods at all reports "No pods yet."', () => {
  assert.deepEqual(validateComplete([]), { complete: false, issues: ['No pods yet.'] });
});

test('validateComplete: no Final pod is an issue', () => {
  const pods: DraftPod[] = [draftPod({ key: 'a', slots: [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 2 }, { kind: 'seed', seed: 3 }, { kind: 'seed', seed: 4 }] })];
  const result = validateComplete(pods);
  assert.equal(result.complete, false);
  assert.ok(!result.complete && result.issues.includes('No pod is marked as the Final yet.'));
});

test('validateComplete: a Final not in the last round is an issue', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'a', round_number: 1, is_final: true, slots: [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 2 }, { kind: 'seed', seed: 3 }, { kind: 'seed', seed: 4 }] }),
    draftPod({ key: 'b', round_number: 2, slots: [{ kind: 'seed', seed: 5 }, { kind: 'seed', seed: 6 }, { kind: 'seed', seed: 7 }, { kind: 'seed', seed: 8 }] }),
  ];
  const result = validateComplete(pods);
  assert.equal(result.complete, false);
  assert.ok(!result.complete && result.issues.includes('The Final must be in the last round.'));
});

test('validateComplete: another pod sharing the Final\'s round is an issue', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'a', round_number: 2, is_final: true, slots: [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 2 }, { kind: 'seed', seed: 3 }, { kind: 'seed', seed: 4 }] }),
    draftPod({ key: 'b', round_number: 2, slots: [{ kind: 'seed', seed: 5 }, { kind: 'seed', seed: 6 }, { kind: 'seed', seed: 7 }, { kind: 'seed', seed: 8 }] }),
  ];
  const result = validateComplete(pods);
  assert.equal(result.complete, false);
  assert.ok(!result.complete && result.issues.includes('The last round must contain only the Final.'));
});

test('validateComplete: empty slots and unclaimed advancements are both counted and pluralized correctly', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'src', round_number: 1, pod_index: 0, advance_rule: 'wildcard', slots: [{ kind: 'seed', seed: 1 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] }),
    draftPod({ key: 'final', round_number: 2, is_final: true, slots: [{ kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] }),
  ];
  const result = validateComplete(pods);
  assert.equal(result.complete, false);
  assert.ok(!result.complete);
  if (!result.complete) {
    assert.ok(result.issues.some((i) => i === '7 slots still unassigned.'));
    // wildcard capacity 3, none claimed -> 3 unclaimed advancements
    assert.ok(result.issues.some((i) => i === '3 advancements not yet routed anywhere.'));
  }
});

test('validateComplete: singular wording for exactly one unassigned slot', () => {
  const pods: DraftPod[] = [
    draftPod({
      key: 'final',
      is_final: true,
      advance_rule: 'single',
      slots: [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 2 }, { kind: 'seed', seed: 3 }, { kind: 'empty' }],
    }),
  ];
  const result = validateComplete(pods);
  assert.equal(result.complete, false);
  assert.ok(!result.complete && result.issues.includes('1 slot still unassigned.'));
});

test('validateComplete: a fully assigned, single-Final-in-last-round bracket with every advancement routed is complete', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'src', round_number: 1, pod_index: 0, advance_rule: 'single', slots: [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 2 }, { kind: 'seed', seed: 3 }, { kind: 'seed', seed: 4 }] }),
    draftPod({
      key: 'final',
      round_number: 2,
      pod_index: 0,
      is_final: true,
      advance_rule: 'single',
      slots: [{ kind: 'advance', sourcePodKey: 'src', ordinal: 0 }, { kind: 'seed', seed: 5 }, { kind: 'seed', seed: 6 }, { kind: 'seed', seed: 7 }],
    }),
  ];
  assert.deepEqual(validateComplete(pods), { complete: true });
});

// ─── draftToPreviewPods ──────────────────────────────────────────────────────

test('draftToPreviewPods: an unsaved pod gets a negative synthetic id; a persisted pod keeps its real id', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'new', persistedId: null }),
    draftPod({ key: 'old', persistedId: 77 }),
  ];
  const preview = draftToPreviewPods(pods, new Map());
  assert.equal(preview[0].id, -1);
  assert.equal(preview[1].id, 77);
});

test('draftToPreviewPods: a seed slot in a materialized pod uses the frozen occupant, not the live seed lookup', () => {
  const pods: DraftPod[] = [
    draftPod({
      key: '1',
      persistedId: 1,
      materialized: true,
      materializedOccupants: [{ playerId: 100, playerName: 'Frozen Alice' }, null, null, null],
      slots: [{ kind: 'seed', seed: 1 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }],
    }),
  ];
  const playerBySeed = new Map([[1, { id: 999, name: 'Current Standings Alice' }]]);
  const preview = draftToPreviewPods(pods, playerBySeed);
  assert.equal(preview[0].slots[0].player_id, 100);
  assert.equal(preview[0].slots[0].player_name, 'Frozen Alice');
});

test('draftToPreviewPods: a seed slot in an unmaterialized pod resolves live against playerBySeed', () => {
  const pods: DraftPod[] = [draftPod({ key: '1', slots: [{ kind: 'seed', seed: 2 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] })];
  const playerBySeed = new Map([[2, { id: 55, name: 'Bob' }]]);
  const preview = draftToPreviewPods(pods, playerBySeed);
  assert.equal(preview[0].slots[0].player_id, 55);
  assert.equal(preview[0].slots[0].player_name, 'Bob');
});

test('draftToPreviewPods: an advance slot resolves source_pod_id via the draft key and carries no player', () => {
  const pods: DraftPod[] = [
    draftPod({ key: 'src', persistedId: 5 }),
    draftPod({ key: 'dst', slots: [{ kind: 'advance', sourcePodKey: 'src', ordinal: 0 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] }),
  ];
  const preview = draftToPreviewPods(pods, new Map());
  const dst = preview.find((p) => p.id === -2)!;
  assert.equal(dst.slots[0].source_pod_id, 5);
  assert.equal(dst.slots[0].player_id, null);
});

test('draftToPreviewPods: an empty slot renders as a fully-null seed-kind slot', () => {
  const pods: DraftPod[] = [draftPod({ key: '1' })];
  const preview = draftToPreviewPods(pods, new Map());
  assert.deepEqual(preview[0].slots[0], {
    slot_index: 0,
    source_kind: 'seed',
    source_seed: null,
    source_pod_id: null,
    player_id: null,
    player_name: null,
  });
});

report();
