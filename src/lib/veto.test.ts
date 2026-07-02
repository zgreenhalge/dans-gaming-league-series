/**
 * Unit tests for isVetoComplete — gates server provisioning (the incomplete->complete transition
 * fires it), so both the gauntlet/playoff shape (4 bans, no pick/side) and the regular shape (bans +
 * pick + starting side) need their own case, plus that a partial set of fields in either shape isn't
 * mistaken for complete.
 *
 * Run:  npx tsx src/lib/veto.test.ts
 */

import assert from 'node:assert/strict';
import { isVetoComplete, type VetoFields } from './veto';

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

const full: VetoFields = {
  shirts_ban: 'Palais',
  shirts_ban2: 'Nuke',
  skins_ban1: 'Vertigo',
  skins_ban2: 'Ascent',
  shirts_pick: 'Train Yard',
  skins_starting_side: 'CT',
};

test('isVetoComplete: gauntlet/playoff only needs the 4 bans', () => {
  const m: VetoFields = { ...full, shirts_pick: null, skins_starting_side: null };
  assert.equal(isVetoComplete(m, true), true);
});

test('isVetoComplete: gauntlet/playoff with a missing ban is incomplete', () => {
  const m: VetoFields = { ...full, shirts_pick: null, skins_starting_side: null, skins_ban2: null };
  assert.equal(isVetoComplete(m, true), false);
});

test('isVetoComplete: regular season needs bans + pick + starting side', () => {
  assert.equal(isVetoComplete(full, false), true);
});

test('isVetoComplete: regular season with all 4 bans but no pick is incomplete', () => {
  const m: VetoFields = { ...full, shirts_pick: null };
  assert.equal(isVetoComplete(m, false), false);
});

test('isVetoComplete: regular season with a pick but no starting side is incomplete', () => {
  const m: VetoFields = { ...full, skins_starting_side: null };
  assert.equal(isVetoComplete(m, false), false);
});

test('isVetoComplete: all-null is incomplete in both shapes', () => {
  const m: VetoFields = {
    shirts_ban: null,
    shirts_ban2: null,
    skins_ban1: null,
    skins_ban2: null,
    shirts_pick: null,
    skins_starting_side: null,
  };
  assert.equal(isVetoComplete(m, true), false);
  assert.equal(isVetoComplete(m, false), false);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
