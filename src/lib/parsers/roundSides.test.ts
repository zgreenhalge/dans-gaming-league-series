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
  const events = [round(13), round(24)];
  const sides = buildRoundSides(events, 'CT', 13);
  assert.ok(sides.every((s) => s.shirtsSide === 'CT'));
});

test('buildRoundSides: round 12 (last of half 1) and round 13 (first of half 2) straddle the flip', () => {
  const events = [round(12), round(13)];
  const [r12, r13] = buildRoundSides(events, 'CT', 13);
  assert.equal(r12.shirtsSide, 'T');
  assert.equal(r13.shirtsSide, 'CT');
});

test('buildRoundSides: OT alternates every 3 rounds, starting with the "other" side', () => {
  // regRoundsPerHalf = 12, so OT starts at round 25. skinsStartingSide 'CT' -> shirts start 'T',
  // other side is 'CT'. otRound 1-3 -> otHalf 1 (other side, CT); otRound 4-6 -> otHalf 2 (start side, T).
  const events = [round(25), round(27), round(28), round(30)];
  const sides = buildRoundSides(events, 'CT', 13);
  assert.equal(sides[0].shirtsSide, 'CT'); // round 25: otRound 1 -> otHalf 1 -> other (CT)
  assert.equal(sides[1].shirtsSide, 'CT'); // round 27: otRound 3 -> otHalf 1 -> other (CT)
  assert.equal(sides[2].shirtsSide, 'T'); // round 28: otRound 4 -> otHalf 2 -> start (T)
  assert.equal(sides[3].shirtsSide, 'T'); // round 30: otRound 6 -> otHalf 2 -> start (T)
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
