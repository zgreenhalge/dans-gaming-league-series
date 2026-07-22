/**
 * Unit tests for collectTeamkill — teamkills committed, credited to the attacker. A same-side
 * death is a teamkill; a cross-side death is a normal kill and must not count.
 *
 * Run:  npx tsx src/lib/parsers/teamkill.test.ts
 */

import assert from 'node:assert/strict';
import { collectTeamkill } from './teamkill';
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

test('collectTeamkill: a same-side kill is credited to the attacker', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'b', attacker: 'a' })]; // a, b both CT
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectTeamkill(deaths, ctx, ids);
  assert.equal(out.get('a')?.teamkills, 1);
  assert.equal(out.get('b')?.teamkills ?? 0, 0);
});

test('collectTeamkill: a cross-side kill is not a teamkill', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'c', attacker: 'a' })]; // a CT, c T
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectTeamkill(deaths, ctx, ids);
  assert.equal(out.get('a')?.teamkills ?? 0, 0);
});

test('collectTeamkill: multiple teamkills in a match accumulate', () => {
  const rounds2 = [
    { roundNumber: 1, winnerSide: 'CT' as const },
    { roundNumber: 2, winnerSide: 'T' as const },
  ];
  const deaths = [
    death({ round: 1, tick: 100, victim: 'b', attacker: 'a' }),
    death({ round: 2, tick: 200, victim: 'd', attacker: 'c' }),
  ];
  const ctx = makeContext({ rounds: rounds2, sides, deaths });
  const out = collectTeamkill(deaths, ctx, ids);
  assert.equal(out.get('a')?.teamkills, 1);
  assert.equal(out.get('c')?.teamkills, 1);
});

test('collectTeamkill: a death with no attacker (world/self) is ignored', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'a', attacker: null })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectTeamkill(deaths, ctx, ids);
  for (const sid of ids) assert.equal(out.get(sid)?.teamkills ?? 0, 0);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
