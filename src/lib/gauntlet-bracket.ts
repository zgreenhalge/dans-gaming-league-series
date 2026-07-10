/**
 * Pure, deterministic gauntlet bracket generator. Operates entirely on abstract seed numbers
 * (1..N, seed 1 = canonical-sort leader) — the caller maps seeds to player_ids from the paired
 * regular season's leaderboard order. See docs/calculations.md#canonical-gauntlet-ranking and
 * `canonicalGauntletRankMap` in util.ts for the read-path contract this bracket shape must satisfy:
 * the final pod must be the sole pod in the maximum round_number, and eliminated players' last
 * appearance must be the round they lost (both fall out naturally here).
 *
 * Every N from 6-20 has a literal worked shape (not a general optimizer) — see the reference
 * oracle in gauntlet-bracket.test.ts. N outside that range throws rather than guessing an
 * unspecified shape.
 */

export type AdvanceRule = 'single' | 'wildcard';

export interface PodSlotPlan {
  slot_index: 0 | 1 | 2 | 3;
  source_kind: 'seed' | 'pod';
  source_seed?: number;
  source_round?: number;
  source_pod_index?: number;
}

export interface PodPlan {
  round_number: number;
  pod_index: number;
  advance_rule: AdvanceRule;
  is_final: boolean;
  slots: PodSlotPlan[];
}

export interface BracketPlan {
  pods: PodPlan[];
  games: number;
  drops: number[];
}

/**
 * Distributes an ordered seed list across `numGroups` pods so each pod gets one seed per tier.
 * Snake pattern per block of `2 * numGroups` seeds: forward 0..numGroups-1, then backward
 * numGroups-1..0 (endpoints repeat), repeating for further blocks. This is the exact pattern
 * behind the handoff's worked N=13 pods (A={2,7,8,13}, B={3,6,9,12}, C={4,5,10,11}) and the N=12
 * pair ({4,7,8,11}/{5,6,9,10}).
 */
function snakeGroups(seeds: number[], numGroups: number): number[][] {
  const groups: number[][] = Array.from({ length: numGroups }, () => []);
  const blockSize = numGroups * 2;
  seeds.forEach((seed, i) => {
    const rel = i % blockSize;
    const g = rel < numGroups ? rel : blockSize - 1 - rel;
    groups[g].push(seed);
  });
  return groups;
}

function seedSlots(seeds: number[]): PodSlotPlan[] {
  return seeds.map((seed, i) => ({
    slot_index: i as 0 | 1 | 2 | 3,
    source_kind: 'seed',
    source_seed: seed,
  }));
}

function podSlots(round_number: number, pod_index: number, count: number, startIndex = 0): PodSlotPlan[] {
  return Array.from({ length: count }, (_, i) => ({
    slot_index: (startIndex + i) as 0 | 1 | 2 | 3,
    source_kind: 'pod' as const,
    source_round: round_number,
    source_pod_index: pod_index,
  }));
}

/** N <= 7: rest ladder. Every round is one wildcard pod; the 4 lowest-seeded live players play,
 * top seeds rest, until 4 remain for the final. Rank-1 seed rests until the final. */
function buildLadder(N: number): BracketPlan {
  const totalRounds = N - 3;
  const pods: PodPlan[] = [];
  for (let r = 1; r <= totalRounds; r++) {
    const isFinal = r === totalRounds;
    const slots: PodSlotPlan[] =
      r === 1
        ? seedSlots([N - 3, N - 2, N - 1, N])
        : [
            { slot_index: 0, source_kind: 'seed', source_seed: N - 2 - r },
            ...podSlots(r - 1, 0, 3, 1),
          ];
    // Final's advance_rule is unused by the engine (is_final pods never propagate) — 'single' is
    // the closer narrative fit (one champion) than 'wildcard' ("3 of 4 advance").
    pods.push({ round_number: r, pod_index: 0, advance_rule: isFinal ? 'single' : 'wildcard', is_final: isFinal, slots });
  }
  return { pods, games: totalRounds * 2, drops: [] };
}

/** N = 8: one wildcard pod (top 4 seeds, 3 advance) + one single pod (bottom 4 seeds, 1 advances)
 * feed directly into the final. No rest, no drop — the cap blocks reaching 8 games. */
function build8(): BracketPlan {
  const pods: PodPlan[] = [
    { round_number: 1, pod_index: 0, advance_rule: 'wildcard', is_final: false, slots: seedSlots([1, 2, 3, 4]) },
    { round_number: 1, pod_index: 1, advance_rule: 'single', is_final: false, slots: seedSlots([5, 6, 7, 8]) },
    {
      round_number: 2,
      pod_index: 0,
      advance_rule: 'single',
      is_final: true,
      slots: [...podSlots(1, 1, 1, 0), ...podSlots(1, 0, 3, 1)],
    },
  ];
  return { pods, games: 6, drops: [] };
}

/** N = 9/10/11: drop down to 9 qualifiers, then identical 3-round shape — R1 rest{1}, wildcard
 * {2,3,4,5}, single{6,7,8,9}; R2 rest{1} again, wildcard over the 4 R1 survivors; final = {1} + 3
 * R2 survivors. */
function build9to11(N: number): BracketPlan {
  const drops = Array.from({ length: N - 9 }, (_, i) => 10 + i);
  const pods: PodPlan[] = [
    { round_number: 1, pod_index: 0, advance_rule: 'wildcard', is_final: false, slots: seedSlots([2, 3, 4, 5]) },
    { round_number: 1, pod_index: 1, advance_rule: 'single', is_final: false, slots: seedSlots([6, 7, 8, 9]) },
    {
      round_number: 2,
      pod_index: 0,
      advance_rule: 'wildcard',
      is_final: false,
      slots: [...podSlots(1, 0, 3, 0), ...podSlots(1, 1, 1, 3)],
    },
    {
      round_number: 3,
      pod_index: 0,
      advance_rule: 'single',
      is_final: true,
      slots: [{ slot_index: 0, source_kind: 'seed', source_seed: 1 }, ...podSlots(2, 0, 3, 1)],
    },
  ];
  return { pods, games: 8, drops };
}

/** N = 12: drop seed 12, R1 rest{1,2,3} with two single pods snake-seeded over {4..11}; R2 rest{1}
 * again, wildcard over {2, 3, + the 2 R1 survivors}; final = {1} + 3 R2 survivors. */
function build12(): BracketPlan {
  const [groupA, groupB] = snakeGroups([4, 5, 6, 7, 8, 9, 10, 11], 2);
  const pods: PodPlan[] = [
    { round_number: 1, pod_index: 0, advance_rule: 'single', is_final: false, slots: seedSlots(groupA) },
    { round_number: 1, pod_index: 1, advance_rule: 'single', is_final: false, slots: seedSlots(groupB) },
    {
      round_number: 2,
      pod_index: 0,
      advance_rule: 'wildcard',
      is_final: false,
      slots: [
        { slot_index: 0, source_kind: 'seed', source_seed: 2 },
        { slot_index: 1, source_kind: 'seed', source_seed: 3 },
        ...podSlots(1, 0, 1, 2),
        ...podSlots(1, 1, 1, 3),
      ],
    },
    {
      round_number: 3,
      pod_index: 0,
      advance_rule: 'single',
      is_final: true,
      slots: [{ slot_index: 0, source_kind: 'seed', source_seed: 1 }, ...podSlots(2, 0, 3, 1)],
    },
  ];
  return { pods, games: 8, drops: [12] };
}

/** N = 13-19: the plateau. Seed 1 byes to the final; seeds 2-13 snake-seed into 3 single-advance
 * pods; bottom N-13 relegated. One rule, 8 games, seven league sizes. */
function buildPlateau(N: number): BracketPlan {
  const qualifiers = Array.from({ length: 12 }, (_, i) => i + 2); // seeds 2..13
  const [groupA, groupB, groupC] = snakeGroups(qualifiers, 3);
  const pods: PodPlan[] = [
    { round_number: 1, pod_index: 0, advance_rule: 'single', is_final: false, slots: seedSlots(groupA) },
    { round_number: 1, pod_index: 1, advance_rule: 'single', is_final: false, slots: seedSlots(groupB) },
    { round_number: 1, pod_index: 2, advance_rule: 'single', is_final: false, slots: seedSlots(groupC) },
    {
      round_number: 2,
      pod_index: 0,
      advance_rule: 'single',
      is_final: true,
      slots: [
        { slot_index: 0, source_kind: 'seed', source_seed: 1 },
        ...podSlots(1, 0, 1, 1),
        ...podSlots(1, 1, 1, 2),
        ...podSlots(1, 2, 1, 3),
      ],
    },
  ];
  const drops = Array.from({ length: N - 13 }, (_, i) => 14 + i);
  return { pods, games: 8, drops };
}

/** N = 20: drop the bottom 4, four single pods snake-seeded over the remaining 16, all four feed
 * the final directly. No rest — the cap blocks reaching 8 games. */
function build20(): BracketPlan {
  const groups = snakeGroups(
    Array.from({ length: 16 }, (_, i) => i + 1),
    4,
  );
  const pods: PodPlan[] = groups.map((seeds, i) => ({
    round_number: 1,
    pod_index: i,
    advance_rule: 'single' as const,
    is_final: false,
    slots: seedSlots(seeds),
  }));
  pods.push({
    round_number: 2,
    pod_index: 0,
    advance_rule: 'single',
    is_final: true,
    slots: groups.map((_, i) => podSlots(1, i, 1, i)[0]),
  });
  return { pods, games: 10, drops: [17, 18, 19, 20] };
}

export function buildGauntletBracket(N: number): BracketPlan {
  if (N >= 4 && N <= 7) return buildLadder(N);
  if (N === 8) return build8();
  if (N >= 9 && N <= 11) return build9to11(N);
  if (N === 12) return build12();
  if (N >= 13 && N <= 19) return buildPlateau(N);
  if (N === 20) return build20();
  throw new Error(`buildGauntletBracket: unsupported qualifier count N=${N} (supported: 4-20)`);
}

export interface PreviewSlot {
  slot_index: number;
  source_kind: 'seed' | 'pod';
  source_seed: number | null;
  source_pod_id: number | null;
  player_id: null;
  player_name: null;
}

export interface PreviewPod {
  id: number;
  round_number: number;
  pod_index: number;
  advance_rule: AdvanceRule;
  is_final: boolean;
  played: false;
  slots: PreviewSlot[];
}

/** Renders a freshly-computed (not yet persisted) bracket plan into the same shape
 * `getGauntletBracketShape()` reads back from the database, so `GauntletBracketDiagram` can preview
 * a plan before anything is written. Synthesizes sequential ids for pods since none exist yet —
 * stable within one plan, not meaningful across calls or once the shape is actually persisted. */
export function planToPreviewPods(plan: BracketPlan): PreviewPod[] {
  const idByKey = new Map<string, number>();
  const key = (round: number, index: number) => `${round}:${index}`;
  plan.pods.forEach((pod, i) => idByKey.set(key(pod.round_number, pod.pod_index), i + 1));

  return plan.pods.map((pod) => ({
    id: idByKey.get(key(pod.round_number, pod.pod_index))!,
    round_number: pod.round_number,
    pod_index: pod.pod_index,
    advance_rule: pod.advance_rule,
    is_final: pod.is_final,
    played: false,
    slots: pod.slots.map((slot) => ({
      slot_index: slot.slot_index,
      source_kind: slot.source_kind,
      source_seed: slot.source_kind === 'seed' ? (slot.source_seed ?? null) : null,
      source_pod_id:
        slot.source_kind === 'pod' ? (idByKey.get(key(slot.source_round!, slot.source_pod_index!)) ?? null) : null,
      player_id: null,
      player_name: null,
    })),
  }));
}
