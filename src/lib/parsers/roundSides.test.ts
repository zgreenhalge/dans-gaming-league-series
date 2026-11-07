/**
 * Unit tests for buildRoundSides — the CT/T side-per-round assignment used to split every stat
 * (kills_ct/kills_t, KAST, clutches...) by side. Off-by-one here silently mislabels every stat in
 * the match, so lock down the regulation-half boundary, the OT swap cadence, and the
 * unknown-starting-side bail-out.
 *
 * Run:  npx vitest run src/lib/parsers/roundSides.test.ts
 */

import assert from 'node:assert/strict';
import { buildRoundSides, sideForFaction, sideForRealRound, roundsPlayedBySide, type RoundEndRow } from './roundSides';
import { test, report } from '../test-support/miniTest';

function round(n: number, winner: 'CT' | 'T' | null = 'CT', warmup = false): RoundEndRow {
  return { tick: n * 1000, total_rounds_played: n, winner, is_warmup_period: warmup, reason: null };
}

// MR12 (targetWinRounds = 13): 12 rounds per regulation half.
test('buildRoundSides: null starting side returns no rounds', () => {
  assert.deepEqual(buildRoundSides([round(1)], null, 13), []);
});

test('buildRoundSides: first regulation half keeps shirts on the start side', () => {
  const events = [round(1), round(2), round(12)];
  const sides = buildRoundSides(events, 'CT', 13); // skins start CT → shirts start T
  assert.ok(sides.every((s) => s.shirtsSide === 'T'));
});

test('buildRoundSides: second regulation half flips shirts to the other side', () => {
  // The half-swap boundary is relative to the first live round, so the full sequence from round 1
  // has to be present for round 13/24 to land in the second half.
  const events = Array.from({ length: 24 }, (_, i) => round(i + 1));
  const byNum = new Map(buildRoundSides(events, 'CT', 13).map((s) => [s.roundNumber, s]));
  assert.equal(byNum.get(13)!.shirtsSide, 'CT');
  assert.equal(byNum.get(24)!.shirtsSide, 'CT');
});

test('buildRoundSides: round 12 (last of half 1) and round 13 (first of half 2) straddle the flip', () => {
  const events = Array.from({ length: 13 }, (_, i) => round(i + 1));
  const byNum = new Map(buildRoundSides(events, 'CT', 13).map((s) => [s.roundNumber, s]));
  assert.equal(byNum.get(12)!.shirtsSide, 'T');
  assert.equal(byNum.get(13)!.shirtsSide, 'CT');
});

test('buildRoundSides: OT swaps mid-period and not between periods', () => {
  // regRoundsPerHalf = 12, so OT starts at round 25. skinsStartingSide 'CT' -> shirts start 'T',
  // other (regulation H2) side is 'CT'. Each OT period is 2 + 2 rounds: swap after its first 2
  // rounds, none at the period boundary. Rounds 25-26 CT, 27-30 T, 31-34 CT, 35-38 T.
  const events = Array.from({ length: 38 }, (_, i) => round(i + 1));
  const byNum = new Map(buildRoundSides(events, 'CT', 13).map((s) => [s.roundNumber, s]));
  const expected: Record<number, 'CT' | 'T'> = {
    24: 'CT', 25: 'CT', 26: 'CT', 27: 'T', 28: 'T', 29: 'T', 30: 'T',
    31: 'CT', 32: 'CT', 33: 'CT', 34: 'CT', 35: 'T', 36: 'T', 37: 'T', 38: 'T',
  };
  for (const [n, side] of Object.entries(expected)) {
    assert.equal(byNum.get(Number(n))!.shirtsSide, side, `round ${n}`);
  }
});

test('buildRoundSides: warmup and rounds with no winner are excluded', () => {
  const events: RoundEndRow[] = [
    { tick: 100, total_rounds_played: 0, winner: null, is_warmup_period: true, reason: null },
    { tick: 200, total_rounds_played: 0, winner: null, is_warmup_period: false, reason: null }, // total_rounds_played 0 also excluded
    round(1),
  ];
  const sides = buildRoundSides(events, 'CT', 13);
  assert.equal(sides.length, 1);
  assert.equal(sides[0].roundNumber, 1);
});

test('buildRoundSides: skinsStartingSide T flips the initial assignment', () => {
  const sides = buildRoundSides([round(1)], 'T', 13);
  assert.equal(sides[0].shirtsSide, 'CT');
});

test('buildRoundSides: a pre-match round (erroneous knife round) is excluded by matchStartTick', () => {
  // The engine counted an erroneous knife round as total_rounds_played 1, then never reset its
  // counter, so the real rounds carry numbers 2..14. matchStartTick sits between the knife
  // round_end and the first real round_end, so the knife round is dropped by TICK.
  const knife: RoundEndRow = { tick: 100, total_rounds_played: 1, winner: 'T', is_warmup_period: false, reason: null };
  const real = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((n) => round(n));
  const sides = buildRoundSides([knife, ...real], 'CT', 13, 500);

  // Knife round gone; the 13 real rounds survive.
  assert.equal(sides.length, 13);
  assert.ok(!sides.some((s) => s.roundNumber === 1));
});

test('buildRoundSides: half-swap boundary tracks the first surviving round, not the raw engine number', () => {
  // The knife round shifted every real round's engine number up by 1 (real round 1 = engine 2,
  // ..., real round 13 = engine 14). The half swap still lands after 12 *real* rounds — i.e. at
  // engine round 14 (real round 13) — not at engine round 13, which is still real round 12.
  const knife: RoundEndRow = { tick: 100, total_rounds_played: 1, winner: 'T', is_warmup_period: false, reason: null };
  const real = [2, 12, 13, 14].map((n) => round(n));
  const sides = buildRoundSides([knife, ...real], 'CT', 13, 500);

  const byNum = new Map(sides.map((s) => [s.roundNumber, s]));
  assert.equal(byNum.get(2)!.shirtsSide, 'T'); // real round 1: first half
  assert.equal(byNum.get(12)!.shirtsSide, 'T'); // real round 11: still first half
  assert.equal(byNum.get(13)!.shirtsSide, 'T'); // real round 12: last round of first half
  assert.equal(byNum.get(14)!.shirtsSide, 'CT'); // real round 13: first round of second half
});

test('buildRoundSides: matchStartTick defaults to 0 (no tick filtering) for demos with no knife round', () => {
  const events = [round(1), round(2)];
  assert.equal(buildRoundSides(events, 'CT', 13).length, 2);
});

// --- startingRealRound: anchoring the half-swap for a segment that begins mid-match ---
//
// A demo segment that doesn't start at the match's true round 1 (e.g. one of several GOTV
// recordings split by a server restart) needs the half/OT-swap boundary anchored on the
// match-wide round count, not this segment's own first live round. These lock that anchoring in
// isolation, with no dependency on multi-segment merging (that's the merge layer's job) — this is
// purely "does buildRoundSides place the swap at the right *real* round when a caller says this
// segment doesn't start at real round 1."

test('buildRoundSides: without startingRealRound, a segment beginning mid-match miscomputes the ' +
  'half-swap relative to its own first round (the bug this offset exists to fix)', () => {
  // Engine rounds 5..23, parsed as if this were the whole match: firstRoundNumber=5 is (wrongly)
  // treated as real round 1, so the flip lands 12 rounds later at engine round 17 (real round 13
  // by this segment's own count), not the true engine round 13.
  const events = Array.from({ length: 19 }, (_, i) => round(i + 5));
  const byNum = new Map(buildRoundSides(events, 'CT', 13).map((s) => [s.roundNumber, s]));
  assert.equal(byNum.get(13)!.shirtsSide, 'T'); // still first half by this (wrong) reckoning
  assert.equal(byNum.get(17)!.shirtsSide, 'CT'); // segment-relative flip lands here instead
});

test('buildRoundSides: startingRealRound anchors the half-swap on the match-wide round count', () => {
  // Same engine rounds 5..23, now told this segment's first live round IS real round 5 (4 real
  // rounds already played in a prior segment). The flip must land at the true engine round 13.
  const events = Array.from({ length: 19 }, (_, i) => round(i + 5));
  const byNum = new Map(
    buildRoundSides(events, 'CT', 13, 0, 5).map((s) => [s.roundNumber, s]),
  );
  assert.equal(byNum.get(12)!.shirtsSide, 'T'); // real round 12: last of first half
  assert.equal(byNum.get(13)!.shirtsSide, 'CT'); // real round 13: first of second half
  assert.equal(byNum.get(23)!.shirtsSide, 'CT'); // real round 23: still second half
});

test('buildRoundSides: startingRealRound defaults to 1, matching every existing single-segment call', () => {
  const events = Array.from({ length: 13 }, (_, i) => round(i + 1));
  const withDefault = buildRoundSides(events, 'CT', 13);
  const withExplicit1 = buildRoundSides(events, 'CT', 13, 0, 1);
  assert.deepEqual(withDefault, withExplicit1);
});

test('sideForFaction: SHIRTS returns the round shirts side, SKINS returns the opposite', () => {
  const info = { roundNumber: 1, endTick: 0, winnerSide: 'CT' as const, shirtsSide: 'T' as const, winReason: 'elim' as const };
  assert.equal(sideForFaction(info, 'SHIRTS'), 'T');
  assert.equal(sideForFaction(info, 'SKINS'), 'CT');
});

test('roundsPlayedBySide: null starting side or no rounds played returns zero both sides', () => {
  assert.deepEqual(roundsPlayedBySide(null, 20, 13, 2), { ct: 0, t: 0 });
  assert.deepEqual(roundsPlayedBySide('CT', 0, 13, 2), { ct: 0, t: 0 });
});

test('roundsPlayedBySide: a regulation-only match splits evenly at the half boundary', () => {
  // MR12 (targetWinRounds 13): 12 rounds/half. A team starting CT that played all 24
  // rounds spent 12 on CT (first half) and 12 on T (second half, post-swap).
  assert.deepEqual(roundsPlayedBySide('CT', 24, 13, 2), { ct: 12, t: 12 });
});

test('roundsPlayedBySide: partway through the first half stays entirely on the starting side', () => {
  assert.deepEqual(roundsPlayedBySide('T', 5, 13, 2), { ct: 0, t: 5 });
});

test('roundsPlayedBySide: matches buildRoundSides round-by-round for the same schedule', () => {
  // Cross-check against buildRoundSides (event-driven) for a match that runs through two OT periods, to
  // confirm both entry points agree on the same per-round side assignment.
  const events = Array.from({ length: 38 }, (_, i) => round(i + 1));
  const sides = buildRoundSides(events, 'CT', 13); // skins start CT -> shirts start T
  const expected = { ct: 0, t: 0 };
  for (const s of sides) {
    if (s.shirtsSide === 'CT') expected.ct++;
    else expected.t++;
  }
  assert.deepEqual(roundsPlayedBySide('T', 38, 13, 2), expected);
});

// --- 3-round OT halves (mp_overtime_maxrounds 6) ---
// Same schedule as the 2-round test above with the half size as 3: OT starts at round 25 on the
// regulation-H2 side, swaps after 3 rounds, not at the period boundary, and swaps again 3 rounds
// into the next period.

test('buildRoundSides: 3-round OT halves swap after 3 rounds of the period', () => {
  const events = Array.from({ length: 42 }, (_, i) => round(i + 1));
  const byNum = new Map(
    buildRoundSides(events, 'CT', 13, 0, 1, 3).map((s) => [s.roundNumber, s]),
  );
  const expected: Record<number, 'CT' | 'T'> = {
    24: 'CT', 25: 'CT', 26: 'CT', 27: 'CT', 28: 'T', 29: 'T', 30: 'T',
    31: 'T', 32: 'T', 33: 'T', 34: 'CT', 35: 'CT', 36: 'CT', 37: 'CT', 38: 'CT', 39: 'CT',
    40: 'T', 41: 'T', 42: 'T',
  };
  for (const [n, side] of Object.entries(expected)) {
    assert.equal(byNum.get(Number(n))!.shirtsSide, side, `round ${n}`);
  }
});

test('sideForRealRound: the OT half size changes only rounds past regulation', () => {
  for (let n = 1; n <= 24; n++) {
    assert.equal(sideForRealRound(n, 'T', 13, 2), sideForRealRound(n, 'T', 13, 3), `round ${n}`);
  }
  assert.notEqual(sideForRealRound(27, 'T', 13, 2), sideForRealRound(27, 'T', 13, 3));
});

test('roundsPlayedBySide: agrees with buildRoundSides for 3-round OT halves', () => {
  const events = Array.from({ length: 42 }, (_, i) => round(i + 1));
  const expected = { ct: 0, t: 0 };
  for (const s of buildRoundSides(events, 'CT', 13, 0, 1, 3)) {
    if (s.shirtsSide === 'CT') expected.ct++;
    else expected.t++;
  }
  assert.deepEqual(roundsPlayedBySide('T', 42, 13, 3), expected);
});

report();
