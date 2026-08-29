/**
 * Unit tests for weaponClasses.ts's weapon-identity helpers (#474) — weaponGroupKey (collapsing
 * every knife/bayonet skin into one `knife` key) and weaponDisplayName (CS2 buy-menu names instead
 * of raw backend classnames). killWeaponCategory's own category-bucketing behavior is covered
 * indirectly via queries-kills.test.ts's aggregateKillCategoryStats coverage.
 *
 * Run:  npx vitest run src/lib/parsers/weaponClasses.test.ts
 */

import assert from 'node:assert/strict';
import { weaponGroupKey, weaponDisplayName, KILL_WEAPON_CATEGORIES, KILL_WEAPON_CATEGORY_LABEL, WEAPON_CATEGORIES } from './weaponClasses';
import { test, report } from '../test-support/miniTest';

test('weaponGroupKey: every knife/bayonet variant collapses to one "knife" key', () => {
  assert.equal(weaponGroupKey('knife'), 'knife');
  assert.equal(weaponGroupKey('knife_karambit'), 'knife');
  assert.equal(weaponGroupKey('bayonet'), 'knife');
  assert.equal(weaponGroupKey('knife_m9_bayonet'), 'knife');
});

test('weaponGroupKey: strips the weapon_ prefix and lowercases, leaving every other weapon as its own key', () => {
  assert.equal(weaponGroupKey('weapon_ak47'), 'ak47');
  assert.equal(weaponGroupKey('AK47'), 'ak47');
  assert.equal(weaponGroupKey('usp_silencer'), 'usp_silencer');
});

test('weaponDisplayName: maps known backend classnames to their CS2 buy-menu display names', () => {
  assert.equal(weaponDisplayName('ak47'), 'AK-47');
  assert.equal(weaponDisplayName('usp_silencer'), 'USP-S');
  assert.equal(weaponDisplayName('m4a1_silencer'), 'M4A1-S');
  assert.equal(weaponDisplayName('hkp2000'), 'P2000');
  assert.equal(weaponDisplayName('deagle'), 'Desert Eagle');
});

test('weaponDisplayName: every knife/bayonet variant displays as "Knife"', () => {
  assert.equal(weaponDisplayName('knife_karambit'), 'Knife');
  assert.equal(weaponDisplayName('bayonet'), 'Knife');
});

test('weaponDisplayName: an unrecognized weapon falls back to a title-cased version of its key', () => {
  assert.equal(weaponDisplayName('some_new_weapon'), 'Some New Weapon');
});

test('KILL_WEAPON_CATEGORIES: every entry has a display label', () => {
  for (const c of KILL_WEAPON_CATEGORIES) {
    assert.ok(KILL_WEAPON_CATEGORY_LABEL[c], `missing label for category ${c}`);
  }
});

test('WEAPON_CATEGORIES: the five gun categories are a subset of KILL_WEAPON_CATEGORIES', () => {
  for (const c of WEAPON_CATEGORIES) {
    assert.ok((KILL_WEAPON_CATEGORIES as string[]).includes(c), `${c} missing from KILL_WEAPON_CATEGORIES`);
  }
  assert.deepEqual([...WEAPON_CATEGORIES].sort(), ['pistol', 'rifle', 'shotgun', 'smg', 'sniper']);
});

report();
