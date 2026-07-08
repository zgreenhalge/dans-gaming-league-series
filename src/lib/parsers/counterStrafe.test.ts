/**
 * Unit tests for collectCounterStrafe — counter-strafing % (#173 phase 3.1). Speed is derived
 * from a 1-tick position delta (this parser exposes no direct velocity read — confirmed against
 * a real DGLS demo), so these fixtures supply position rows at the fire tick and one tick prior.
 *
 * Run:  npx tsx src/lib/parsers/counterStrafe.test.ts
 */

import assert from 'node:assert/strict';
import { collectCounterStrafe, type PlayerTickRow } from './counterStrafe';
import { makeContext } from './matchContextFixture';
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

function tickRow(opts: { tick: number; steamid: string; ducked?: boolean; maxSpeed?: number; x: number; y: number }): PlayerTickRow {
  return {
    tick: opts.tick,
    steamid: opts.steamid,
    ducked: opts.ducked ?? false,
    maxSpeed: opts.maxSpeed ?? 230,
    x: opts.x,
    y: opts.y,
  };
}

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const ids = Object.keys(sides);
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];
const tickRate = 64;

test('collectCounterStrafe: a standing rifle shot below 34% max speed is a good counter-strafe', () => {
  const fires = [fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_ak47' })];
  const rows = [
    tickRow({ tick: 99, steamid: 'a', x: 0, y: 0 }),
    tickRow({ tick: 100, steamid: 'a', x: 1, y: 0 }), // speed = 1/(1/64) = 64 < 0.34*230=78.2
  ];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectCounterStrafe(fires, rows, ctx, ids);
  assert.equal(out.get('a')?.counter_strafe_shots, 1);
  assert.equal(out.get('a')?.counter_strafe_good_shots, 1);
});

test('collectCounterStrafe: a fast-moving rifle shot is not a good counter-strafe, but still counts as a shot', () => {
  const fires = [fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_ak47' })];
  const rows = [
    tickRow({ tick: 99, steamid: 'a', x: 0, y: 0 }),
    tickRow({ tick: 100, steamid: 'a', x: 5, y: 0 }), // speed = 5/(1/64) = 320 > 78.2
  ];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectCounterStrafe(fires, rows, ctx, ids);
  assert.equal(out.get('a')?.counter_strafe_shots, 1);
  assert.equal(out.get('a')?.counter_strafe_good_shots ?? 0, 0);
});

test('collectCounterStrafe: a crouched shot is excluded entirely', () => {
  const fires = [fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_ak47' })];
  const rows = [
    tickRow({ tick: 99, steamid: 'a', x: 0, y: 0 }),
    tickRow({ tick: 100, steamid: 'a', ducked: true, x: 1, y: 0 }),
  ];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectCounterStrafe(fires, rows, ctx, ids);
  assert.equal(out.get('a')?.counter_strafe_shots ?? 0, 0);
});

test('collectCounterStrafe: a non-rifle shot is not counted', () => {
  const fires = [fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_glock' })];
  const rows = [
    tickRow({ tick: 99, steamid: 'a', x: 0, y: 0 }),
    tickRow({ tick: 100, steamid: 'a', x: 1, y: 0 }),
  ];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectCounterStrafe(fires, rows, ctx, ids);
  assert.equal(out.get('a')?.counter_strafe_shots ?? 0, 0);
});

test('collectCounterStrafe: missing tick data is skipped safely', () => {
  const fires = [fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_ak47' })];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectCounterStrafe(fires, [], ctx, ids);
  assert.equal(out.get('a')?.counter_strafe_shots ?? 0, 0);
  assert.equal(out.get('a')?.counter_strafe_good_shots ?? 0, 0);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
