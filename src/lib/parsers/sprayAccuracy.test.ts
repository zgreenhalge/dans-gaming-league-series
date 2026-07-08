/**
 * Unit tests for collectSprayAccuracy — spray accuracy within sequences of 3+ rifle shots
 * (#173 phase 3.2).
 *
 * Run:  npx tsx src/lib/parsers/sprayAccuracy.test.ts
 */

import assert from 'node:assert/strict';
import { collectSprayAccuracy } from './sprayAccuracy';
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
const tickRate = 64;
// SPRAY_GAP_SECONDS = 0.25 -> 16 ticks at 64 tick rate.

test('collectSprayAccuracy: 3+ rapid shots form a sequence and count all shots fired', () => {
  const fires: WeaponFireRow[] = [
    fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_ak47' }),
    fire({ round: 1, tick: 108, user: 'a', weapon: 'weapon_ak47' }),
    fire({ round: 1, tick: 116, user: 'a', weapon: 'weapon_ak47' }),
  ];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectSprayAccuracy(fires, [], ctx, ids);
  assert.equal(out.get('a')?.spray_shots_fired, 3);
});

test('collectSprayAccuracy: fewer than 3 shots in a sequence do not count', () => {
  const fires: WeaponFireRow[] = [
    fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_ak47' }),
    fire({ round: 1, tick: 108, user: 'a', weapon: 'weapon_ak47' }),
  ];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectSprayAccuracy(fires, [], ctx, ids);
  assert.equal(out.get('a')?.spray_shots_fired ?? 0, 0);
});

test('collectSprayAccuracy: a gap larger than the spray window splits the sequence', () => {
  const fires: WeaponFireRow[] = [
    fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_ak47' }),
    fire({ round: 1, tick: 108, user: 'a', weapon: 'weapon_ak47' }),
    fire({ round: 1, tick: 200, user: 'a', weapon: 'weapon_ak47' }), // >16 ticks later: a tap, not a continuation
    fire({ round: 1, tick: 208, user: 'a', weapon: 'weapon_ak47' }),
  ];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectSprayAccuracy(fires, [], ctx, ids);
  assert.equal(out.get('a')?.spray_shots_fired ?? 0, 0); // both halves are only 2 shots each
});

test('collectSprayAccuracy: enemy hits landing within the sequence window count as spray_shots_hit', () => {
  const fires: WeaponFireRow[] = [
    fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_ak47' }),
    fire({ round: 1, tick: 108, user: 'a', weapon: 'weapon_ak47' }),
    fire({ round: 1, tick: 116, user: 'a', weapon: 'weapon_ak47' }),
  ];
  const hurts = [
    hurt({ round: 1, tick: 108, attacker: 'a', victim: 'c', weapon: 'ak47' }),
    hurt({ round: 1, tick: 300, attacker: 'a', victim: 'c', weapon: 'ak47' }), // outside the sequence window
  ];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectSprayAccuracy(fires, hurts, ctx, ids);
  assert.equal(out.get('a')?.spray_shots_hit, 1);
});

test('collectSprayAccuracy: switching weapons mid-burst does not merge into one sequence', () => {
  const fires: WeaponFireRow[] = [
    fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_ak47' }),
    fire({ round: 1, tick: 108, user: 'a', weapon: 'weapon_m4a1' }),
    fire({ round: 1, tick: 116, user: 'a', weapon: 'weapon_ak47' }),
  ];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectSprayAccuracy(fires, [], ctx, ids);
  assert.equal(out.get('a')?.spray_shots_fired ?? 0, 0); // 2 lone ak47 shots + 1 lone m4a1 shot
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
