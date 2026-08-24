/**
 * Unit tests for weaponIconSrc() and weaponIconAspect() — the kill/fire weapon classname →
 * icon path/aspect-ratio lookups shared by the DOM WeaponIcon component and the 2D Replay
 * canvas's kill feed/bomb marker.
 *
 * Run:  npx vitest run src/lib/weaponIcons.test.ts
 */

import assert from 'node:assert/strict';
import { weaponIconSrc, weaponIconAspect } from './weaponIcons';
import { test, report } from './test-support/miniTest';

test('weaponIconSrc: a plain gun name resolves to its icon', () => {
  assert.equal(weaponIconSrc('ak47'), '/weapon-icons/ak47.svg');
});

test('weaponIconSrc: a weapon_-prefixed classname strips the prefix first', () => {
  assert.equal(weaponIconSrc('weapon_awp'), '/weapon-icons/awp.svg');
});

test('weaponIconSrc: matching is case-insensitive', () => {
  assert.equal(weaponIconSrc('AK47'), '/weapon-icons/ak47.svg');
});

test('weaponIconSrc: any knife/bayonet variant falls back to the generic knife icon', () => {
  assert.equal(weaponIconSrc('knife_karambit'), '/weapon-icons/knife.svg');
  assert.equal(weaponIconSrc('bayonet'), '/weapon-icons/knife.svg');
});

test('weaponIconSrc: hegrenade resolves to the HE icon', () => {
  assert.equal(weaponIconSrc('hegrenade'), '/grenade-icons/he.svg');
});

test('weaponIconSrc: molotov, incgrenade, inferno, incendiary, and fire all resolve to the same fire icon', () => {
  const expected = '/grenade-icons/molotov.svg';
  assert.equal(weaponIconSrc('molotov'), expected);
  assert.equal(weaponIconSrc('incgrenade'), expected);
  assert.equal(weaponIconSrc('inferno'), expected);
  assert.equal(weaponIconSrc('incendiary'), expected);
  assert.equal(weaponIconSrc('fire'), expected);
});

test('weaponIconSrc: null/undefined/unmapped weapons return null', () => {
  assert.equal(weaponIconSrc(null), null);
  assert.equal(weaponIconSrc(undefined), null);
  assert.equal(weaponIconSrc('world'), null);
  assert.equal(weaponIconSrc(''), null);
});

test('weaponIconAspect: a wide rifle reports a much wider-than-tall ratio', () => {
  // awp.svg's viewBox is 109.5x32 — far from square, the case that was rendering as a
  // near-invisible sliver when every icon was forced into a fixed square box.
  assert.ok(weaponIconAspect('awp') > 3);
});

test('weaponIconAspect: a near-square pistol reports a ratio close to 1', () => {
  // hkp2000.svg's viewBox is 32.167x32.
  const ratio = weaponIconAspect('hkp2000');
  assert.ok(ratio > 0.9 && ratio < 1.1);
});

test('weaponIconAspect: null/undefined/unmapped weapons default to square (1)', () => {
  assert.equal(weaponIconAspect(null), 1);
  assert.equal(weaponIconAspect(undefined), 1);
  assert.equal(weaponIconAspect('world'), 1);
});

report();
