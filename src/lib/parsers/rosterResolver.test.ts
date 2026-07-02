/**
 * Unit tests for the elimination-warning round-trip. The warning string is the carrier for
 * demo-learned steam ids (the score-confirm path parses it back), so the builder and parser must
 * stay in lockstep — this locks that.
 *
 * Run:  npx tsx src/lib/parsers/rosterResolver.test.ts
 */

import assert from 'node:assert/strict';
import { eliminationWarning, parseEliminationWarning } from './rosterResolver';

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

test('build → parse round-trips the parts', () => {
  const w = eliminationWarning('RedLetter', '76561198028252465', 'Tim');
  const r = parseEliminationWarning(w);
  assert.deepEqual(r, { demoName: 'RedLetter', steamId: '76561198028252465', rosterName: 'Tim' });
});

test('names with spaces round-trip', () => {
  const w = eliminationWarning('Red Letter Day', '76561198000000001', 'Big Tim');
  const r = parseEliminationWarning(w);
  assert.equal(r?.demoName, 'Red Letter Day');
  assert.equal(r?.rosterName, 'Big Tim');
  assert.equal(r?.steamId, '76561198000000001');
});

test('a non-elimination warning parses to null', () => {
  assert.equal(parseEliminationWarning('Starting side unknown — enter the score manually.'), null);
  assert.equal(parseEliminationWarning(''), null);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
