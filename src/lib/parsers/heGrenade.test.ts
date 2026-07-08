/**
 * Unit tests for collectHeGrenades — HE grenade throws and enemy damage (#173 phase 2.1).
 * weapon_fire and player_hurt name the same weapon differently (weapon_hegrenade vs
 * hegrenade) — the throw/damage split exercises both.
 *
 * Run:  npx tsx src/lib/parsers/heGrenade.test.ts
 */

import assert from 'node:assert/strict';
import { collectHeGrenades } from './heGrenade';
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

test('collectHeGrenades: he_thrown only counts weapon_hegrenade fire events', () => {
  const fires: WeaponFireRow[] = [
    fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_hegrenade' }),
    fire({ round: 1, tick: 150, user: 'a', weapon: 'weapon_flashbang' }),
    fire({ round: 1, tick: 200, user: 'a', weapon: 'weapon_hegrenade' }),
  ];
  const ctx = makeContext({ rounds, sides });
  const out = collectHeGrenades(fires, [], ctx, ids);
  assert.equal(out.get('a')?.he_thrown, 2);
});

test('collectHeGrenades: HE damage to an enemy is credited to the attacker', () => {
  const hurts = [hurt({ round: 1, tick: 100, attacker: 'a', victim: 'c', weapon: 'hegrenade', dmgHealth: 40 })];
  const ctx = makeContext({ rounds, sides });
  const out = collectHeGrenades([], hurts, ctx, ids);
  assert.equal(out.get('a')?.he_damage, 40);
});

test('collectHeGrenades: HE damage to a teammate is not credited', () => {
  const hurts = [hurt({ round: 1, tick: 100, attacker: 'a', victim: 'b', weapon: 'hegrenade', dmgHealth: 40 })];
  const ctx = makeContext({ rounds, sides });
  const out = collectHeGrenades([], hurts, ctx, ids);
  assert.equal(out.get('a')?.he_damage ?? 0, 0);
});

test('collectHeGrenades: self-damage is not credited', () => {
  const hurts = [hurt({ round: 1, tick: 100, attacker: 'a', victim: 'a', weapon: 'hegrenade', dmgHealth: 20 })];
  const ctx = makeContext({ rounds, sides });
  const out = collectHeGrenades([], hurts, ctx, ids);
  assert.equal(out.get('a')?.he_damage ?? 0, 0);
});

test('collectHeGrenades: non-HE damage is ignored', () => {
  const hurts = [hurt({ round: 1, tick: 100, attacker: 'a', victim: 'c', weapon: 'ak47', dmgHealth: 40 })];
  const ctx = makeContext({ rounds, sides });
  const out = collectHeGrenades([], hurts, ctx, ids);
  assert.equal(out.get('a')?.he_damage ?? 0, 0);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
