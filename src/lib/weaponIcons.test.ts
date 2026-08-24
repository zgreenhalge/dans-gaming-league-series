/**
 * Unit tests for weaponIconSrc() — the kill/fire weapon classname → icon path lookup shared by
 * the DOM WeaponIcon component and the 2D Replay canvas's kill feed/bomb marker.
 *
 * Run:  npx vitest run src/lib/weaponIcons.test.ts
 */

import assert from 'node:assert/strict';
import { weaponIconSrc } from './weaponIcons';
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

report();
