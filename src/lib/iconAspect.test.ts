/**
 * Unit tests for iconAspect() — the width-to-height ratio lookup shared by every renderer of a
 * non-square icon asset (weapon icons via WeaponIcon, grenade sticker-toolbar icons via
 * ReplayPlayer).
 *
 * Run:  npx vitest run src/lib/iconAspect.test.ts
 */

import assert from 'node:assert/strict';
import { iconAspect } from './iconAspect';
import { test, report } from './test-support/miniTest';

test('iconAspect: a wide rifle reports a much wider-than-tall ratio', () => {
  assert.ok(iconAspect('/weapon-icons/awp.svg') > 3);
});

test('iconAspect: a near-square pistol reports a ratio close to 1', () => {
  const ratio = iconAspect('/weapon-icons/hkp2000.svg');
  assert.ok(ratio > 0.9 && ratio < 1.1);
});

test('iconAspect: a taller-than-wide grenade icon reports a ratio below 1', () => {
  assert.ok(iconAspect('/grenade-icons/smoke.svg') < 1);
});

test('iconAspect: null/undefined/unlisted paths default to square (1)', () => {
  assert.equal(iconAspect(null), 1);
  assert.equal(iconAspect(undefined), 1);
  assert.equal(iconAspect('/round-icons/bomb.svg'), 1);
});

report();
