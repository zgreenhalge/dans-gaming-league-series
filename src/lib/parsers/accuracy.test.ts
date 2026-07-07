/**
 * Unit tests for collectAccuracy — raw accuracy / head accuracy (#173 phase 3.3).
 *
 * Run:  npx tsx src/lib/parsers/accuracy.test.ts
 */

import assert from 'node:assert/strict';
import { collectAccuracy } from './accuracy';
import { makeContext, hurt } from './matchContextFixture';
import type { WeaponFireRow } from './utility';

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

function fire(opts: { round: number; tick: number; user: string | null; weapon: string }): WeaponFireRow {
  return { tick: opts.tick, total_rounds_played: opts.round - 1, user_steamid: opts.user, weapon: opts.weapon };
}

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const ids = Object.keys(sides);
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];

test('collectAccuracy: gun shots count toward shots_fired, grenade throws do not', () => {
  const fires: WeaponFireRow[] = [
    fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_ak47' }),
    fire({ round: 1, tick: 150, user: 'a', weapon: 'weapon_hegrenade' }),
    fire({ round: 1, tick: 200, user: 'a', weapon: 'weapon_ak47' }),
  ];
  const ctx = makeContext({ rounds, sides });
  const out = collectAccuracy(fires, [], ctx, ids);
  assert.equal(out.get('a')?.shots_fired, 2);
});

test('collectAccuracy: a gun hit on an enemy counts toward shots_hit', () => {
  const hurts = [hurt({ round: 1, tick: 100, attacker: 'a', victim: 'c', weapon: 'ak47', dmgHealth: 27 })];
  const ctx = makeContext({ rounds, sides });
  const out = collectAccuracy([], hurts, ctx, ids);
  assert.equal(out.get('a')?.shots_hit, 1);
});

test('collectAccuracy: a headshot hitgroup counts toward headshot_hits as well as shots_hit', () => {
  const hurts = [hurt({ round: 1, tick: 100, attacker: 'a', victim: 'c', weapon: 'ak47', dmgHealth: 100, hitgroup: 1 })];
  const ctx = makeContext({ rounds, sides });
  const out = collectAccuracy([], hurts, ctx, ids);
  assert.equal(out.get('a')?.shots_hit, 1);
  assert.equal(out.get('a')?.headshot_hits, 1);
});

test('collectAccuracy: a non-head hitgroup does not count toward headshot_hits', () => {
  const hurts = [hurt({ round: 1, tick: 100, attacker: 'a', victim: 'c', weapon: 'ak47', dmgHealth: 27, hitgroup: 2 })];
  const ctx = makeContext({ rounds, sides });
  const out = collectAccuracy([], hurts, ctx, ids);
  assert.equal(out.get('a')?.headshot_hits ?? 0, 0);
});

test('collectAccuracy: HE/molotov damage is not credited toward shots_hit', () => {
  const hurts = [
    hurt({ round: 1, tick: 100, attacker: 'a', victim: 'c', weapon: 'hegrenade', dmgHealth: 40 }),
    hurt({ round: 1, tick: 150, attacker: 'a', victim: 'c', weapon: 'inferno', dmgHealth: 10 }),
  ];
  const ctx = makeContext({ rounds, sides });
  const out = collectAccuracy([], hurts, ctx, ids);
  assert.equal(out.get('a')?.shots_hit ?? 0, 0);
});

test('collectAccuracy: teamdamage and self-damage are not credited', () => {
  const hurts = [
    hurt({ round: 1, tick: 100, attacker: 'a', victim: 'b', weapon: 'ak47', dmgHealth: 27 }), // teammate
    hurt({ round: 1, tick: 150, attacker: 'a', victim: 'a', weapon: 'ak47', dmgHealth: 5 }), // self
  ];
  const ctx = makeContext({ rounds, sides });
  const out = collectAccuracy([], hurts, ctx, ids);
  assert.equal(out.get('a')?.shots_hit ?? 0, 0);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
