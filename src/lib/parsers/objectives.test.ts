/**
 * Unit tests for collectObjectives — plant/defuse counting. Thin, but shares the round+1 offset and
 * liveRounds-gating pattern with every other collector, so a regression there (off-by-one, or
 * forgetting the gate) would silently misattribute every objective stat in the demo pipeline.
 *
 * Run:  npx tsx src/lib/parsers/objectives.test.ts
 */

import assert from 'node:assert/strict';
import { collectObjectives, type BombEventRow } from './objectives';
import { makeContext } from './matchContextFixture';

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

function bombEvent(round: number, tick: number, user: string | null): BombEventRow {
  return { tick, total_rounds_played: round - 1, user_steamid: user };
}

const sides = { a: 'T', b: 'CT' } as const;
const ids = Object.keys(sides);
const rounds = [
  { roundNumber: 1, winnerSide: 'T' as const },
  { roundNumber: 2, winnerSide: 'CT' as const },
];

test('collectObjectives: counts plants and defuses per player', () => {
  const ctx = makeContext({ rounds, sides });
  const plants = [bombEvent(1, 100, 'a'), bombEvent(2, 200, 'a')];
  const defuses = [bombEvent(2, 250, 'b')];
  const out = collectObjectives(plants, defuses, ctx, ids);
  assert.equal(out.get('a')?.plants, 2);
  assert.equal(out.get('b')?.defuses, 1);
  assert.equal(out.get('a')?.defuses ?? 0, 0);
});

test('collectObjectives: events outside liveRounds are dropped', () => {
  const ctx = makeContext({ rounds, sides }); // only rounds 1-2 live
  const plants = [bombEvent(5, 900, 'a')]; // round 5 not live
  const out = collectObjectives(plants, [], ctx, ids);
  assert.equal(out.get('a')?.plants ?? 0, 0);
});

test('collectObjectives: a null/unknown user is ignored, not attributed', () => {
  const ctx = makeContext({ rounds, sides });
  const plants = [bombEvent(1, 100, null), bombEvent(1, 100, 'stranger')];
  const out = collectObjectives(plants, [], ctx, ids);
  assert.equal(out.get('a')?.plants ?? 0, 0);
  assert.equal(out.get('b')?.plants ?? 0, 0);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
