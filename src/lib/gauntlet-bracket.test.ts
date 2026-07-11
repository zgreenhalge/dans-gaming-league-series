/**
 * Oracle test for buildGauntletBracket(N) — locks the generator to the handoff's reference table
 * (games/drops/rest-bye/wildcard-pod counts for N=6-20) and a handful of literal worked-shape seed
 * assignments. No test framework — node:assert + a tiny runner, matching util.test.ts.
 *
 * Run: npx tsx src/lib/gauntlet-bracket.test.ts
 */

import assert from 'node:assert/strict';
import { buildGauntletBracket, projectGauntletSeeding, type PodPlan } from './gauntlet-bracket';

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message}`);
  }
}

/** Sum of (round_number - 1) over every seed-sourced slot — a seed slot in round R implies the
 * seed rested through rounds 1..R-1. */
function restByeCount(pods: PodPlan[]): number {
  let total = 0;
  for (const pod of pods) {
    for (const slot of pod.slots) {
      if (slot.source_kind === 'seed') total += pod.round_number - 1;
    }
  }
  return total;
}

function wildcardPodCount(pods: PodPlan[]): number {
  return pods.filter((p) => !p.is_final && p.advance_rule === 'wildcard').length;
}

function seedsInPod(pod: PodPlan): number[] {
  return pod.slots.filter((s) => s.source_kind === 'seed').map((s) => s.source_seed!).sort((a, b) => a - b);
}

const oracle: { N: number; games: number; drop: number; restBye: number; wildcardPods: number }[] = [
  { N: 6, games: 6, drop: 0, restBye: 3, wildcardPods: 2 },
  { N: 7, games: 8, drop: 0, restBye: 6, wildcardPods: 3 },
  { N: 8, games: 6, drop: 0, restBye: 0, wildcardPods: 1 },
  { N: 9, games: 8, drop: 0, restBye: 2, wildcardPods: 2 },
  { N: 10, games: 8, drop: 1, restBye: 2, wildcardPods: 2 },
  { N: 11, games: 8, drop: 2, restBye: 2, wildcardPods: 2 },
  { N: 12, games: 8, drop: 1, restBye: 4, wildcardPods: 1 },
  { N: 13, games: 8, drop: 0, restBye: 1, wildcardPods: 0 },
  { N: 14, games: 8, drop: 1, restBye: 1, wildcardPods: 0 },
  { N: 15, games: 8, drop: 2, restBye: 1, wildcardPods: 0 },
  { N: 16, games: 8, drop: 3, restBye: 1, wildcardPods: 0 },
  { N: 17, games: 8, drop: 4, restBye: 1, wildcardPods: 0 },
  { N: 18, games: 8, drop: 5, restBye: 1, wildcardPods: 0 },
  { N: 19, games: 8, drop: 6, restBye: 1, wildcardPods: 0 },
  { N: 20, games: 10, drop: 4, restBye: 0, wildcardPods: 0 },
];

for (const row of oracle) {
  test(`N=${row.N} reference oracle counts`, () => {
    const plan = buildGauntletBracket(row.N);
    assert.equal(plan.games, row.games, `games`);
    assert.equal(plan.pods.length * 2, row.games, `pods*2 should equal games`);
    assert.equal(plan.drops.length, row.drop, `drops`);
    assert.equal(restByeCount(plan.pods), row.restBye, `rest/bye`);
    assert.equal(wildcardPodCount(plan.pods), row.wildcardPods, `wildcard pods`);

    // canonicalGauntletRankMap dependency: the max round_number must contain exactly one pod,
    // and it must be the final.
    const maxRound = Math.max(...plan.pods.map((p) => p.round_number));
    const podsInMaxRound = plan.pods.filter((p) => p.round_number === maxRound);
    assert.equal(podsInMaxRound.length, 1, 'exactly one pod in the max round');
    assert.equal(podsInMaxRound[0].is_final, true, 'the max-round pod is the final');
    assert.equal(plan.pods.filter((p) => p.is_final).length, 1, 'exactly one final pod overall');

    // Every non-final pod has exactly one slot filled from it downstream count matching its
    // advance rule's survivor count (single=1, wildcard=3) — checked via how many 'pod' slots
    // elsewhere reference it.
    for (const pod of plan.pods) {
      if (pod.is_final) continue;
      const expectedSurvivors = pod.advance_rule === 'single' ? 1 : 3;
      const referencing = plan.pods
        .flatMap((p) => p.slots)
        .filter((s) => s.source_kind === 'pod' && s.source_round === pod.round_number && s.source_pod_index === pod.pod_index);
      assert.equal(referencing.length, expectedSurvivors, `pod r${pod.round_number}p${pod.pod_index} survivor slot count`);
    }

    // Every pod has exactly 4 slots with unique slot_index 0-3.
    for (const pod of plan.pods) {
      assert.equal(pod.slots.length, 4, `pod r${pod.round_number}p${pod.pod_index} has 4 slots`);
      assert.deepEqual(pod.slots.map((s) => s.slot_index).sort(), [0, 1, 2, 3]);
    }
  });
}

test('N=13 worked shape matches the handoff example exactly', () => {
  const plan = buildGauntletBracket(13);
  const round1 = plan.pods.filter((p) => p.round_number === 1);
  const groups = round1.map(seedsInPod);
  assert.deepEqual(groups, [
    [2, 7, 8, 13],
    [3, 6, 9, 12],
    [4, 5, 10, 11],
  ]);
  const final = plan.pods.find((p) => p.is_final)!;
  assert.deepEqual(seedsInPod(final), [1]);
});

test('N=9 round 1 tiers wildcard on high seeds, single on low seeds', () => {
  const plan = buildGauntletBracket(9);
  const round1 = plan.pods.filter((p) => p.round_number === 1);
  const wildcard = round1.find((p) => p.advance_rule === 'wildcard')!;
  const single = round1.find((p) => p.advance_rule === 'single')!;
  assert.deepEqual(seedsInPod(wildcard), [2, 3, 4, 5]);
  assert.deepEqual(seedsInPod(single), [6, 7, 8, 9]);
});

test('N=12 round 1 snake pairs match the handoff example', () => {
  const plan = buildGauntletBracket(12);
  const round1 = plan.pods.filter((p) => p.round_number === 1);
  const groups = round1.map(seedsInPod);
  assert.deepEqual(groups, [
    [4, 7, 8, 11],
    [5, 6, 9, 10],
  ]);
  assert.deepEqual(plan.drops, [12]);
});

test('N=20 round 1 covers seeds 1-16 exactly once across four single pods', () => {
  const plan = buildGauntletBracket(20);
  const round1 = plan.pods.filter((p) => p.round_number === 1);
  assert.equal(round1.length, 4);
  assert.ok(round1.every((p) => p.advance_rule === 'single'));
  const allSeeds = round1.flatMap(seedsInPod).sort((a, b) => a - b);
  assert.deepEqual(allSeeds, Array.from({ length: 16 }, (_, i) => i + 1));
  assert.deepEqual(plan.drops, [17, 18, 19, 20]);
});

test('N outside 4-20 throws rather than guessing', () => {
  assert.throws(() => buildGauntletBracket(3));
  assert.throws(() => buildGauntletBracket(21));
});

test('N=4 ladder edge case: straight to final, no elimination rounds', () => {
  const plan = buildGauntletBracket(4);
  assert.equal(plan.pods.length, 1);
  assert.equal(plan.games, 2);
  assert.deepEqual(seedsInPod(plan.pods[0]), [1, 2, 3, 4]);
});

// --- projectGauntletSeeding: live "if it ended today" seed placement ---
test('projectGauntletSeeding: N=13 byes seed 1 straight to the final, everyone else placed round 1', () => {
  const placements = projectGauntletSeeding(13)!;
  assert.equal(placements.size, 13);
  const seed1 = placements.get(1);
  assert.deepEqual(seed1, { qualifies: true, round: 2, podIndex: 0, isFinal: true, isBye: true });
  const seed2 = placements.get(2);
  assert.equal(seed2?.qualifies, true);
  assert.equal((seed2 as { isBye: boolean }).isBye, false);
  assert.equal((seed2 as { round: number }).round, 1);
});

test('projectGauntletSeeding: N=14 drops the bottom seed, everyone else still qualifies', () => {
  const placements = projectGauntletSeeding(14)!;
  assert.deepEqual(placements.get(14), { qualifies: false });
  for (let seed = 1; seed <= 13; seed++) {
    assert.equal(placements.get(seed)?.qualifies, true, `seed ${seed} should qualify`);
  }
});

test('projectGauntletSeeding: N=20 drops seeds 17-20, seeds 1-16 all start round 1 (no byes)', () => {
  const placements = projectGauntletSeeding(20)!;
  for (const seed of [17, 18, 19, 20]) assert.deepEqual(placements.get(seed), { qualifies: false });
  for (let seed = 1; seed <= 16; seed++) {
    const p = placements.get(seed);
    assert.equal(p?.qualifies, true);
    assert.equal((p as { isBye: boolean }).isBye, false, `seed ${seed} should not have a bye`);
  }
});

test('projectGauntletSeeding: out-of-range qualifier count returns null instead of throwing', () => {
  assert.equal(projectGauntletSeeding(3), null);
  assert.equal(projectGauntletSeeding(21), null);
});

console.log(`${passed}/${passed + failures.length} passed`);
if (failures.length > 0) {
  console.error('Failures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
