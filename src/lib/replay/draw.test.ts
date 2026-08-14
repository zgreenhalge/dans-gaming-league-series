/**
 * Unit tests for `killWeaponLabel()` — the one piece of `draw.ts` with real branching logic
 * independent of any Canvas2D call (everything else in the module draws directly onto a `Ctx2D`).
 * The engine reports fire damage as the generic `inferno` weapon, which doesn't say whether it was
 * a molotov or an incendiary (issue #128); this recovers the distinction by matching the kill to the
 * attacker's most recent fire grenade at or before the kill tick. The rest of `draw.ts` is
 * legitimately canvas-only — every other helper takes a `Ctx2D` and calls draw methods directly, with
 * no extractable decision logic to test apart from the drawing itself.
 *
 * Run:  npx vitest run src/lib/replay/draw.test.ts
 */

import assert from 'node:assert/strict';
import { killWeaponLabel } from './draw';
import type { ReplayGrenade } from './types';
import { test, report } from '../test-support/miniTest';
import { round } from '../test-support/replayFixtures';

function grenade(overrides: Partial<ReplayGrenade> & { type: string }): ReplayGrenade {
  return { throwerId: 1, detonateTick: 100, trajectory: [], ...overrides } as ReplayGrenade;
}

test('killWeaponLabel: a non-fire weapon is returned verbatim, stripped of its weapon_ prefix', () => {
  assert.equal(killWeaponLabel(round(), { weapon: 'weapon_ak47', attackerId: 1, tick: 500 }), 'ak47');
});

test('killWeaponLabel: a null weapon (world kill) is the empty string, not "fire"', () => {
  assert.equal(killWeaponLabel(round(), { weapon: null, attackerId: null, tick: 500 }), '');
});

test('killWeaponLabel: an inferno kill with no correlated grenade falls back to "fire"', () => {
  assert.equal(killWeaponLabel(round(), { weapon: 'inferno', attackerId: 1, tick: 500 }), 'fire');
});

test('killWeaponLabel: an inferno kill resolves to the thrower\'s molotov', () => {
  const r = round({ grenades: [grenade({ type: 'molotov', throwerId: 1, detonateTick: 100 })] });
  assert.equal(killWeaponLabel(r, { weapon: 'inferno', attackerId: 1, tick: 500 }), 'molotov');
});

test('killWeaponLabel: an inferno kill resolves to the thrower\'s incendiary', () => {
  const r = round({ grenades: [grenade({ type: 'incendiary', throwerId: 1, detonateTick: 100 })] });
  assert.equal(killWeaponLabel(r, { weapon: 'inferno', attackerId: 1, tick: 500 }), 'incendiary');
});

test('killWeaponLabel: only the attacker\'s own fire grenade is matched, not a teammate\'s', () => {
  const r = round({ grenades: [grenade({ type: 'molotov', throwerId: 2, detonateTick: 100 })] });
  assert.equal(killWeaponLabel(r, { weapon: 'inferno', attackerId: 1, tick: 500 }), 'fire');
});

test('killWeaponLabel: a null attackerId (world/self kill) matches any thrower\'s fire grenade', () => {
  const r = round({ grenades: [grenade({ type: 'incendiary', throwerId: 7, detonateTick: 100 })] });
  assert.equal(killWeaponLabel(r, { weapon: 'inferno', attackerId: null, tick: 500 }), 'incendiary');
});

test('killWeaponLabel: a fire grenade that detonates AFTER the kill is never matched', () => {
  const r = round({ grenades: [grenade({ type: 'molotov', throwerId: 1, detonateTick: 600 })] });
  assert.equal(killWeaponLabel(r, { weapon: 'inferno', attackerId: 1, tick: 500 }), 'fire');
});

test('killWeaponLabel: picks the MOST RECENT eligible fire grenade, not the first one thrown', () => {
  const r = round({
    grenades: [
      grenade({ type: 'molotov', throwerId: 1, detonateTick: 100 }),
      grenade({ type: 'incendiary', throwerId: 1, detonateTick: 300 }),
    ],
  });
  assert.equal(killWeaponLabel(r, { weapon: 'inferno', attackerId: 1, tick: 500 }), 'incendiary');
});

test('killWeaponLabel: falls back to the last trajectory tick when detonateTick is null (still in flight)', () => {
  const r = round({
    grenades: [
      grenade({ type: 'molotov', throwerId: 1, detonateTick: null, trajectory: [{ tick: 50, x: 0, y: 0, z: 0 }, { tick: 480, x: 10, y: 10, z: 0 }] }),
    ],
  });
  assert.equal(killWeaponLabel(r, { weapon: 'inferno', attackerId: 1, tick: 500 }), 'molotov');
});

report();
