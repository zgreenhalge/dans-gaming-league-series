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

// ─── Layer 2: pairing each round's teams into actual 2v2 matches ──────────────────────────────
//
// Each round's `teams` list from buildTeammateRounds() needs pairing into matches (2 teams each).
// Unlike teammate coverage, this has no closed-form optimum — a small backtracking search per
// round picks whichever pairing creates the most opponent pairs neither team has faced before,
// tracked in a running set across the whole season (repeats are only unavoidable once every pair
// has already faced off at least once).
//
// A round's team count is odd whenever seedCount mod 4 is 2 or 3 (constant every round for a
// given seedCount, since buildTeammateRounds()'s team count per round never varies) — one team is
// left over with no match. That team's *one and only* teammate pairing (guaranteed exactly once
// by Layer 1) would never actually be played if it just sits out, which breaks the "everyone plays
// with everyone" requirement outright — this isn't an efficiency nice-to-have, it's a correctness
// requirement. `doubleheaderPolicy: 'auto'` (the default) fixes it by borrowing a player (or the
// whole other team, if only one team is short) from an already-scheduled match to field a bonus
// match — that donor plays twice this week instead of the leftover team sitting out. `'never'`
// throws for any seedCount where this would happen, rather than silently dropping the pair.
//
// Picking the best pairing *within* a round greedily doesn't guarantee full opponent coverage
// *across* the season — an early round's locally-best choice can starve a later one when several
// pairings tie for that round's best score (common, especially in early rounds where almost
// everything is still new). Rather than a full global search, ties are broken with a seeded PRNG
// and the whole schedule is regenerated with a new seed whenever the result comes up short,
// verified against the actual coverage requirement before returning — deterministic (same
// seedCount always produces the same schedule) without hand-tuning a smarter search.

export type DoubleheaderPolicy = 'auto' | 'never';

export interface MatchPlan {
  shirts: [number, number];
  skins: [number, number];
}

export interface WeekPlan {
  week: number; // 1-based, same numbering as TeammateRound.round
  matches: MatchPlan[];
  /** Seeds with no match this week. `'auto'` keeps this to at most one seed (only ever the
   * individual seed left over by an odd seedCount, per buildTeammateRounds' byeSeed) — a whole
   * leftover team is always absorbed into a bonus match instead. */
  byeSeeds: number[];
}

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function opponentPairsOf(m: MatchPlan): string[] {
  return [
    pairKey(m.shirts[0], m.skins[0]),
    pairKey(m.shirts[0], m.skins[1]),
    pairKey(m.shirts[1], m.skins[0]),
    pairKey(m.shirts[1], m.skins[1]),
  ];
}

function newOpponentPairCount(a: [number, number], b: [number, number], seen: ReadonlySet<string>): number {
  let count = 0;
  for (const p of a) for (const q of b) if (!seen.has(pairKey(p, q))) count++;
  return count;
}

/** Deterministic PRNG (mulberry32) so a retry attempt is reproducible from its seed alone. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reservoir-samples a uniformly random pick among candidates tied for the best score seen so far
 * — call once per candidate in order; `isFirst`/`isNewBest` reset the reservoir. */
function shouldTakeTiedCandidate(tieCount: number, rand: () => number): boolean {
  return rand() < 1 / tieCount;
}

/** Best perfect matching of an even-length team list into 2-team matches, maximizing total new
 * (not-yet-`seen`) opponent pairs — ties broken uniformly at random via `rand`. Brute-force
 * recursive search — team counts in this league's supported range never exceed ~8, so the ~100
 * -matching search space is trivial; not worth a smarter algorithm for that size. */
function bestMatchPairing(
  teams: [number, number][],
  seen: ReadonlySet<string>,
  rand: () => number,
): { matches: MatchPlan[]; score: number } {
  if (teams.length === 0) return { matches: [], score: 0 };

  const [first, ...rest] = teams;
  let best: { matches: MatchPlan[]; score: number } | null = null;
  let tieCount = 0;
  for (let i = 0; i < rest.length; i++) {
    const partner = rest[i];
    const remaining = [...rest.slice(0, i), ...rest.slice(i + 1)];
    const sub = bestMatchPairing(remaining, seen, rand);
    const score = newOpponentPairCount(first, partner, seen) + sub.score;
    if (!best || score > best.score) {
      best = { matches: [{ shirts: first, skins: partner }, ...sub.matches], score };
      tieCount = 1;
    } else if (score === best.score) {
      tieCount++;
      if (shouldTakeTiedCandidate(tieCount, rand)) {
        best = { matches: [{ shirts: first, skins: partner }, ...sub.matches], score };
      }
    }
  }
  return best!;
}

/** Picks whichever candidate scores highest, ties broken via reservoir sampling with `rand` — the
 * shared "score every candidate, keep the best" shape behind pickDonorTeam/pickDonorPlayer. */
function pickBestByScore<T>(candidates: T[], score: (candidate: T) => number, rand: () => number): T {
  let best = candidates[0];
  let bestScore = -1;
  let tieCount = 0;
  for (const candidate of candidates) {
    const s = score(candidate);
    if (s > bestScore) {
      bestScore = s;
      best = candidate;
      tieCount = 1;
    } else if (s === bestScore) {
      tieCount++;
      if (shouldTakeTiedCandidate(tieCount, rand)) best = candidate;
    }
  }
  return best;
}

/** Picks whichever already-matched team creates the most new opponent pairs against a leftover
 * team, to face it in a bonus (doubleheader) match. `matches` is always non-empty whenever this is
 * called — it's only reached when a round had enough teams to form at least one primary match. */
function pickDonorTeam(matches: MatchPlan[], leftoverTeam: [number, number], seen: ReadonlySet<string>, rand: () => number): [number, number] {
  const candidates = matches.flatMap((m) => [m.shirts, m.skins] as [number, number][]);
  return pickBestByScore(candidates, (candidate) => newOpponentPairCount(leftoverTeam, candidate, seen), rand);
}

/** Same idea as pickDonorTeam, but borrowing a single player (for the 3-leftover case, where the
 * bonus match pairs that donor with the individually-left-over seed). */
function pickDonorPlayer(matches: MatchPlan[], leftoverTeam: [number, number], seen: ReadonlySet<string>, rand: () => number): number {
  const candidates = matches.flatMap((m) => [...m.shirts, ...m.skins]);
  return pickBestByScore(
    candidates,
    (player) => (seen.has(pairKey(player, leftoverTeam[0])) ? 0 : 1) + (seen.has(pairKey(player, leftoverTeam[1])) ? 0 : 1),
    rand,
  );
}

// ─── Shirts/skins side balance ─────────────────────────────────────────────────────────────────
//
// Which team a match calls "shirts" vs "skins" has no bearing on teammate/opponent coverage —
// pairKey() and opponentPairsOf() are symmetric in the two labels — so it's decided as a pass over
// pairings the coverage search has already locked in, never something that search optimizes for.
//
// A single match's two possible orientations is chooseSides()'s job — a simple greedy pick used
// where only one or two matches are in play at once (gauntlet pod labeling, `gauntlet-engine.ts`).
// A whole season's matches all being simultaneously free to flip (their labels don't affect
// coverage at all) is enough freedom that a single greedy forward pass can still land far from
// balanced — optimizeSideBalance() below instead treats the season as one search: repeatedly flip
// whichever single match's flip reduces the season's total |balance| (seeded by `initialBalance`, a
// player's real balance carried in from outside this season) the most, until no flip helps.
//
// A single-flip hill climb from the pairing step's own given orientation gets stuck: the teammate
// round-robin (`buildTeammateRounds()`) always lists seed 1's team first, and `bestMatchPairing()`
// always assigns "first" to `shirts` — so a hill climb starting there finds every one of seed 1's
// matches locked in a mutual stalemate with that round's partner (flipping helps seed 1 exactly as
// much as it hurts the partner, a net-zero move the search never takes) long before the season is
// actually balanced. Randomizing each match's starting orientation before climbing breaks that
// structural symmetry; running several random restarts and keeping the best guards against any one
// restart still landing in a bad optimum. With this league's match-per-season counts (well under 30)
// this converges in a handful of passes per restart.
const BALANCE_SEARCH_RESTARTS = 8;

/** Swaps `m`'s shirts/skins labels in place and updates `balance` to match (each of the 4 players'
 * running balance moves by ∓2 — from +1 to -1, or -1 to +1). */
function flipMatch(m: MatchPlan, balance: Map<number, number>): void {
  for (const seed of m.shirts) balance.set(seed, (balance.get(seed) ?? 0) - 2);
  for (const seed of m.skins) balance.set(seed, (balance.get(seed) ?? 0) + 2);
  [m.shirts, m.skins] = [m.skins, m.shirts];
}

/** The change in total season |balance| that flipping `m` would cause, without actually flipping it
 * — negative means flipping improves the total. */
function flipCostDelta(m: MatchPlan, balance: Map<number, number>): number {
  let delta = 0;
  for (const seed of m.shirts) {
    const bal = balance.get(seed) ?? 0;
    delta += Math.abs(bal - 2) - Math.abs(bal);
  }
  for (const seed of m.skins) {
    const bal = balance.get(seed) ?? 0;
    delta += Math.abs(bal + 2) - Math.abs(bal);
  }
  return delta;
}

/** Commits `teamA` as SHIRTS / `teamB` as SKINS into `balance`, then flips (via `flipMatch()`) if
 * `flipCostDelta()` says the other way round leaves the two teams' combined |balance| smaller — a
 * tie keeps `teamA` as SHIRTS. The same cost math `optimizeSideBalance()`'s search uses, applied
 * once instead of hunting for a global optimum: the right choice when only a match or two are ever
 * in play at once and there's no larger season-wide freedom to exploit (gauntlet pod labeling,
 * `gauntlet-engine.ts`'s `materializePod()`). */
export function chooseSides(
  teamA: [number, number],
  teamB: [number, number],
  balance: Map<number, number>,
): MatchPlan {
  const m: MatchPlan = { shirts: teamA, skins: teamB };
  for (const seed of teamA) balance.set(seed, (balance.get(seed) ?? 0) + 1);
  for (const seed of teamB) balance.set(seed, (balance.get(seed) ?? 0) - 1);
  if (flipCostDelta(m, balance) < 0) flipMatch(m, balance);
  return m;
}

/** Total `sum(|balance|)` across every player currently tracked. */
function totalAbsBalance(balance: Map<number, number>): number {
  let sum = 0;
  for (const v of balance.values()) sum += Math.abs(v);
  return sum;
}

/** One hill climb to a local optimum, starting from `matches`' current orientation and `balance`'s
 * current values (both mutated in place): repeatedly flips whichever single match most reduces the
 * total, breaking ties uniformly via `rand`, until no flip improves. */
function hillClimbSideBalance(matches: MatchPlan[], balance: Map<number, number>, rand: () => number): void {
  for (;;) {
    let bestIdx = -1;
    let bestDelta = 0;
    let tieCount = 0;
    for (let i = 0; i < matches.length; i++) {
      const delta = flipCostDelta(matches[i], balance);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
        tieCount = 1;
      } else if (delta === bestDelta && delta < 0) {
        tieCount++;
        if (shouldTakeTiedCandidate(tieCount, rand)) bestIdx = i;
      }
    }
    if (bestIdx === -1) return;
    flipMatch(matches[bestIdx], balance);
  }
}

/** Runs `BALANCE_SEARCH_RESTARTS` independent hill climbs (see the comment above), each from its own
 * randomized starting orientation seeded by `initialBalance`, and leaves `matches` (mutated in place)
 * at whichever restart reached the lowest total `sum(|balance|)`. */
export function optimizeSideBalance(matches: MatchPlan[], initialBalance: Map<number, number>, rand: () => number): void {
  let best: { cost: number; orientations: MatchPlan[] } | null = null;

  for (let restart = 0; restart < BALANCE_SEARCH_RESTARTS; restart++) {
    const balance = new Map(initialBalance);
    for (const m of matches) {
      if (rand() < 0.5) [m.shirts, m.skins] = [m.skins, m.shirts];
      for (const seed of m.shirts) balance.set(seed, (balance.get(seed) ?? 0) + 1);
      for (const seed of m.skins) balance.set(seed, (balance.get(seed) ?? 0) - 1);
    }

    hillClimbSideBalance(matches, balance, rand);

    const cost = totalAbsBalance(balance);
    if (!best || cost < best.cost) {
      best = { cost, orientations: matches.map((m) => ({ shirts: m.shirts, skins: m.skins })) };
    }
  }

  matches.forEach((m, i) => {
    m.shirts = best!.orientations[i].shirts;
    m.skins = best!.orientations[i].skins;
  });
}

function attemptSchedule(teammateRounds: TeammateRound[], policy: DoubleheaderPolicy, rand: () => number): WeekPlan[] {
  const seenOpponentPairs = new Set<string>();
  const weeks: WeekPlan[] = [];

  for (const round of teammateRounds) {
    const teams = [...round.teams];
    const leftoverTeam = teams.length % 2 === 1 ? teams.pop()! : null;
    const individualLeftover = round.byeSeed;

    const { matches: pairedMatches } = bestMatchPairing(teams, seenOpponentPairs, rand);
    const matches: MatchPlan[] = pairedMatches.map((m) => ({ shirts: m.shirts, skins: m.skins }));
    const byeSeeds: number[] = [];

    if (leftoverTeam && policy === 'auto') {
      if (individualLeftover != null) {
        const donor = pickDonorPlayer(matches, leftoverTeam, seenOpponentPairs, rand);
        matches.push({ shirts: leftoverTeam, skins: [individualLeftover, donor] });
      } else {
        const donorTeam = pickDonorTeam(matches, leftoverTeam, seenOpponentPairs, rand);
        matches.push({ shirts: leftoverTeam, skins: donorTeam });
      }
    } else {
      if (leftoverTeam) byeSeeds.push(...leftoverTeam);
      if (individualLeftover != null) byeSeeds.push(individualLeftover);
    }

    for (const m of matches) for (const key of opponentPairsOf(m)) seenOpponentPairs.add(key);

    weeks.push({ week: round.round, matches, byeSeeds });
  }

  return weeks;
}

/** Teammate/opponent pair sets covered by a flat list of matches — shared by hasFullCoverage()
 * here and validateDraftCompleteness() in season-schedule-validation.ts, since both need the same
 * "what counts as a teammate pair vs. an opponent pair" rule applied to a differently-shaped but
 * structurally identical match list. */
export function collectCoveragePairs(
  matches: { shirts: [number, number]; skins: [number, number] }[],
): { teammatePairs: Set<string>; opponentPairs: Set<string> } {
  const teammatePairs = new Set<string>();
  const opponentPairs = new Set<string>();
  for (const m of matches) {
    teammatePairs.add(pairKey(m.shirts[0], m.shirts[1]));
    teammatePairs.add(pairKey(m.skins[0], m.skins[1]));
    for (const p of m.shirts) for (const q of m.skins) opponentPairs.add(pairKey(p, q));
  }
  return { teammatePairs, opponentPairs };
}

/** Every pair must appear as teammates at least once *and* as opponents at least once — the two
 * hard requirements a generated schedule has to satisfy before it's usable. Teammate coverage is
 * already guaranteed by construction (Layer 1's proof), but checked here too since it's cheap and
 * this is the single place that decides whether an attempt is acceptable. */
function hasFullCoverage(weeks: WeekPlan[], seedCount: number): boolean {
  const { teammatePairs, opponentPairs } = collectCoveragePairs(weeks.flatMap((w) => w.matches));
  const expected = (seedCount * (seedCount - 1)) / 2;
  return teammatePairs.size === expected && opponentPairs.size === expected;
}

const MAX_ATTEMPTS = 200;

/** The league's supported roster-size range (see docs/architecture.md). `bestMatchPairing()`'s
 * search is factorial in team count (~seedCount/2) — cheap within this range (well under 10
 * teams/round) but combinatorially explosive well beyond it, so seedCount is rejected outright
 * rather than left to time out or hang whenever this is wired to a live roster size. Exported so
 * callers (e.g. the schedule-generation API route) can validate a roster size up front with the
 * same bounds, instead of a second hardcoded 7/19 that could drift out of sync with this one. */
export const MIN_SEED_COUNT = 7;
export const MAX_SEED_COUNT = 19;

export function buildSeasonSchedule(
  seedCount: number,
  options?: { doubleheaderPolicy?: DoubleheaderPolicy; initialBalance?: Map<number, number> },
): WeekPlan[] {
  if (seedCount < MIN_SEED_COUNT || seedCount > MAX_SEED_COUNT) {
    throw new Error(
      `buildSeasonSchedule: seedCount=${seedCount} is outside the supported range (${MIN_SEED_COUNT}-${MAX_SEED_COUNT})`,
    );
  }

  const policy = options?.doubleheaderPolicy ?? 'auto';
  const initialBalance = options?.initialBalance ?? new Map<number, number>();
  const teammateRounds = buildTeammateRounds(seedCount);

  if (policy === 'never' && teammateRounds.some((r) => r.teams.length % 2 === 1)) {
    throw new Error(
      `buildSeasonSchedule: doubleheaderPolicy 'never' can't guarantee every pair actually plays together for seedCount=${seedCount} (seedCount mod 4 = ${seedCount % 4} leaves a whole team over every round) — skipping that team's match with no doubleheader would leave its one and only teammate pairing never played. Use 'auto', or a seedCount where seedCount mod 4 is 0 or 1.`,
    );
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rand = mulberry32(seedCount * 100003 + attempt);
    const weeks = attemptSchedule(teammateRounds, policy, rand);
    if (hasFullCoverage(weeks, seedCount)) {
      // Side-balance labeling doesn't affect coverage (see the comment above chooseSides()), so it's
      // only worth optimizing once a schedule has already passed the coverage check — a discarded
      // attempt would otherwise pay for the full local search for nothing.
      optimizeSideBalance(
        weeks.flatMap((w) => w.matches),
        initialBalance,
        rand,
      );
      return weeks;
    }
  }

  throw new Error(
    `buildSeasonSchedule: couldn't find a schedule covering every pair as both teammates and opponents for seedCount=${seedCount} after ${MAX_ATTEMPTS} attempts`,
  );
}
