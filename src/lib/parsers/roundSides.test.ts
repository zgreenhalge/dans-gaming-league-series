/**
 * Unit tests for buildRoundSides — the CT/T side-per-round assignment used to split every stat
 * (kills_ct/kills_t, KAST, clutches...) by side. Off-by-one here silently mislabels every stat in
 * the match, so lock down the regulation-half boundary, the OT-half flip cadence, and the
 * unknown-starting-side bail-out.
 *
 * Run:  npx tsx src/lib/parsers/roundSides.test.ts
 */

import assert from 'node:assert/strict';
import { buildRoundSides, sideForFaction, type RoundEndRow } from './roundSides';

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
  }
}

function round(n: number, winner: 'CT' | 'T' | null = 'CT', warmup = false): RoundEndRow {
  return { tick: n * 1000, total_rounds_played: n, winner, is_warmup_period: warmup };
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

test('buildRoundSides: OT alternates every 3 rounds, starting with the "other" side', () => {
  // regRoundsPerHalf = 12, so OT starts at round 25. skinsStartingSide 'CT' -> shirts start 'T',
  // other side is 'CT'. otRound 1-3 -> otHalf 1 (other side, CT); otRound 4-6 -> otHalf 2 (start side, T).
  const events = Array.from({ length: 30 }, (_, i) => round(i + 1));
  const byNum = new Map(buildRoundSides(events, 'CT', 13).map((s) => [s.roundNumber, s]));
  assert.equal(byNum.get(25)!.shirtsSide, 'CT'); // round 25: otRound 1 -> otHalf 1 -> other (CT)
  assert.equal(byNum.get(27)!.shirtsSide, 'CT'); // round 27: otRound 3 -> otHalf 1 -> other (CT)
  assert.equal(byNum.get(28)!.shirtsSide, 'T'); // round 28: otRound 4 -> otHalf 2 -> start (T)
  assert.equal(byNum.get(30)!.shirtsSide, 'T'); // round 30: otRound 6 -> otHalf 2 -> start (T)
});

test('buildRoundSides: warmup and rounds with no winner are excluded', () => {
  const events: RoundEndRow[] = [
    { tick: 100, total_rounds_played: 0, winner: null, is_warmup_period: true },
    { tick: 200, total_rounds_played: 0, winner: null, is_warmup_period: false }, // total_rounds_played 0 also excluded
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
  const knife: RoundEndRow = { tick: 100, total_rounds_played: 1, winner: 'T', is_warmup_period: false };
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
  const knife: RoundEndRow = { tick: 100, total_rounds_played: 1, winner: 'T', is_warmup_period: false };
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

test('sideForFaction: SHIRTS returns the round shirts side, SKINS returns the opposite', () => {
  const info = { roundNumber: 1, endTick: 0, winnerSide: 'CT' as const, shirtsSide: 'T' as const };
  assert.equal(sideForFaction(info, 'SHIRTS'), 'T');
  assert.equal(sideForFaction(info, 'SKINS'), 'CT');
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
