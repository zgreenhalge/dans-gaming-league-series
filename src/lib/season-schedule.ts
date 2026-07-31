/**
 * Pure, deterministic teammate-pairing generator for a regular season's Wingman (2v2) roster.
 * Builds the minimum-round schedule in which every pair of seeds (1..N) is teammates exactly
 * once — the harder of the two matchup-generation coverage requirements (every pair as
 * teammates, every pair as opponents). Operates entirely on abstract seed numbers, same
 * convention as `buildGauntletBracket()` (`gauntlet-bracket.ts`): the caller maps seeds to
 * player_ids from the season's roster.
 *
 * Implementation: a standard round-robin "circle method" 1-factorization of the complete graph
 * K_N. A single match's 2v2 split can create at most floor(N/2) new teammate pairs per round, and
 * there are N(N-1)/2 pairs total to cover, so no schedule can do it in fewer rounds than this
 * produces — it's the counting-bound floor, not just an approximation:
 *
 * - N even: N-1 rounds, each a perfect matching (N/2 disjoint teammate pairs, nobody left over).
 *   K_N decomposes into exactly N-1 perfect matchings for even N (its edge chromatic number).
 * - N odd: K_N has no perfect matching (odd number of vertices), so add a phantom (N+1)th seed
 *   and run the same method on N+1 (even) players for N rounds — whichever real seed lands paired
 *   with the phantom in a given round has no teammate that round (`byeSeed`).
 */

export interface TeammateRound {
  round: number; // 1-based
  teams: [number, number][]; // disjoint pairs of seeds, teammates this round
  byeSeed: number | null; // the one seed with no teammate this round (odd seedCount only)
}

/** 1-factorization of K_m via the circle method: seed 1 stays fixed, seeds 2..m rotate around it.
 * `m` must be even. Returns m-1 rounds, each a perfect matching (m/2 disjoint pairs) — together
 * they partition every edge of K_m exactly once. */
function oneFactorization(m: number): [number, number][][] {
  const rounds: [number, number][][] = [];
  const rot = Array.from({ length: m - 1 }, (_, i) => i + 2); // seeds 2..m
  for (let r = 0; r < m - 1; r++) {
    const pairs: [number, number][] = [[1, rot[0]]];
    for (let i = 1; i <= (m - 2) / 2; i++) {
      pairs.push([rot[i], rot[m - 1 - i]]);
    }
    rounds.push(pairs);
    rot.unshift(rot.pop()!);
  }
  return rounds;
}

export function buildTeammateRounds(seedCount: number): TeammateRound[] {
  if (!Number.isInteger(seedCount) || seedCount < 2) {
    throw new Error(`buildTeammateRounds: seedCount must be an integer >= 2 (got ${seedCount})`);
  }

  const isOdd = seedCount % 2 === 1;
  const phantom = seedCount + 1;
  const m = isOdd ? phantom : seedCount;
  const rounds = oneFactorization(m);

  return rounds.map((pairs, i) => {
    if (!isOdd) return { round: i + 1, teams: pairs, byeSeed: null };
    const byePair = pairs.find((p) => p.includes(phantom))!;
    const byeSeed = byePair[0] === phantom ? byePair[1] : byePair[0];
    const teams = pairs.filter((p) => !p.includes(phantom));
    return { round: i + 1, teams, byeSeed };
  });
}
