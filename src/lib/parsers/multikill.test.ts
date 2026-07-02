/**
 * Unit tests for collectMultikill — 2K-round detection (a player kills both enemies who share the
 * round). Exercises the "exactly two enemies this round" gate and that both enemy deaths must be
 * attributed to the same attacker (a teamkill of one enemy by someone else shouldn't count toward
 * this player's 2K).
 *
 * Run:  npx tsx src/lib/parsers/multikill.test.ts
 */

import assert from 'node:assert/strict';
import { collectMultikill } from './multikill';
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

test('collectMultikill: killing both enemies this round counts as a 2K round', () => {
  const deaths = [
    death({ round: 1, tick: 100, victim: 'c', attacker: 'a' }),
    death({ round: 1, tick: 200, victim: 'd', attacker: 'a' }),
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectMultikill(deaths, ctx, ids);
  assert.equal(out.get('a')?.two_k_rounds, 1);
});

test('collectMultikill: only one of the two enemy kills does not count', () => {
  const deaths = [
    death({ round: 1, tick: 100, victim: 'c', attacker: 'a' }),
    death({ round: 1, tick: 200, victim: 'd', attacker: 'b' }), // b, not a, gets the second kill
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectMultikill(deaths, ctx, ids);
  assert.equal(out.get('a')?.two_k_rounds ?? 0, 0);
  assert.equal(out.get('b')?.two_k_rounds ?? 0, 0);
});

test('collectMultikill: with 3+ enemies (e.g. 4v4 lineup) the exactly-two-enemies gate skips entirely', () => {
  const bigSides = { a: 'CT', b: 'CT', c: 'CT', d: 'CT', e: 'T', f: 'T', g: 'T', h: 'T' } as const;
  const bigIds = Object.keys(bigSides);
  const deaths = [
    death({ round: 1, tick: 100, victim: 'e', attacker: 'a' }),
    death({ round: 1, tick: 200, victim: 'f', attacker: 'a' }),
  ];
  const ctx = makeContext({ rounds, sides: bigSides, deaths });
  const out = collectMultikill(deaths, ctx, bigIds);
  // a has 4 enemies (g, h still alive on record — enemies list is computed from sides, not alive state)
  assert.equal(out.get('a')?.two_k_rounds ?? 0, 0);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
