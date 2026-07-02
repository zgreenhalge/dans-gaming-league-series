/**
 * Unit tests for collectEntry — opening kill/death attribution. Only the FIRST death of the round
 * (by tick) counts, and an opening teamkill must not be credited as an opening kill (the victim still
 * gets the opening death either way). Both are easy to get backwards.
 *
 * Run:  npx tsx src/lib/parsers/entry.test.ts
 */

import assert from 'node:assert/strict';
import { collectEntry } from './entry';
import { makeContext, death } from './matchContextFixture';

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

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const ids = Object.keys(sides);
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];

test('collectEntry: the first death of the round credits opening kill + death', () => {
  const deaths = [
    death({ round: 1, tick: 100, victim: 'c', attacker: 'a' }), // first
    death({ round: 1, tick: 200, victim: 'd', attacker: 'a' }), // second -- should not count
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectEntry(deaths, ctx, ids);
  assert.equal(out.get('a')?.opening_kills, 1);
  assert.equal(out.get('c')?.opening_deaths, 1);
  assert.equal(out.get('d')?.opening_deaths ?? 0, 0);
});

test('collectEntry: an opening teamkill credits the opening death but not an opening kill', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'b', attacker: 'a' })]; // a, b both CT
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectEntry(deaths, ctx, ids);
  assert.equal(out.get('b')?.opening_deaths, 1);
  assert.equal(out.get('a')?.opening_kills ?? 0, 0);
});

test('collectEntry: deaths are ordered by tick, not array order', () => {
  const deaths = [
    death({ round: 1, tick: 500, victim: 'd', attacker: 'a' }), // listed first but later tick
    death({ round: 1, tick: 100, victim: 'c', attacker: 'b' }), // actually first
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectEntry(deaths, ctx, ids);
  assert.equal(out.get('c')?.opening_deaths, 1);
  assert.equal(out.get('b')?.opening_kills, 1);
  assert.equal(out.get('d')?.opening_deaths ?? 0, 0);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
