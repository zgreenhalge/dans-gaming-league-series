/**
 * Unit tests for queries/duels.ts's computeMatchDuels() (#461) — a single match's per-pair kill
 * exchange, headshots, damage, and weapon-category breakdown, computed from already-joined
 * MatchKillRow[]/MatchDamageEventRow[] in memory, so no fake-DB harness is needed.
 *
 * Run:  npx vitest run src/lib/queries-duels.test.ts
 */

import assert from 'node:assert/strict';
import { computeMatchDuels } from './queries/duels';
import type { MatchKillRow } from './queries/kills';
import type { MatchDamageEventRow } from './queries/damage';
import { test, report } from './test-support/miniTest';

function kill(opts: {
  round?: number;
  tick?: number;
  attacker: number | null;
  victim: number;
  weapon: string;
  headshot?: boolean;
}): MatchKillRow {
  return {
    match_id: 1,
    season_id: 1,
    round_number: opts.round ?? 1,
    attacker_player_id: opts.attacker,
    attacker_name: opts.attacker != null ? `p${opts.attacker}` : null,
    victim_player_id: opts.victim,
    victim_name: `p${opts.victim}`,
    assister_player_id: null,
    weapon: opts.weapon,
    headshot: opts.headshot ?? false,
    noscope: false,
    wallbang: false,
    blind_kill: false,
    midair: false,
    is_teamkill: false,
    tick: opts.tick ?? 100,
  };
}

function dmg(opts: {
  round?: number;
  tick?: number;
  attacker: number | null;
  victim: number;
  weapon: string;
  damage: number;
}): MatchDamageEventRow {
  return {
    match_id: 1,
    round_number: opts.round ?? 1,
    attacker_player_id: opts.attacker,
    victim_player_id: opts.victim,
    weapon: opts.weapon,
    damage: opts.damage,
    hitgroup: 'chest',
    tick: opts.tick ?? 100,
  };
}

test('computeMatchDuels: counts kills each direction between one pair, and headshots within them', () => {
  const kills = [
    kill({ attacker: 1, victim: 2, weapon: 'ak47', headshot: true }),
    kill({ attacker: 1, victim: 2, weapon: 'ak47' }),
    kill({ attacker: 2, victim: 1, weapon: 'deagle', headshot: true }),
  ];
  const [duel] = computeMatchDuels(kills, [], [1], [2]);
  assert.equal(duel.aKills, 2);
  assert.equal(duel.bKills, 1);
  assert.equal(duel.aHeadshots, 1);
  assert.equal(duel.bHeadshots, 1);
});

test('computeMatchDuels: returns every aIds × bIds combination, zeroed for pairs with no kills either way', () => {
  const kills = [kill({ attacker: 1, victim: 3, weapon: 'ak47' })];
  const duels = computeMatchDuels(kills, [], [1, 2], [3, 4]);
  assert.equal(duels.length, 4);
  assert.deepEqual(
    duels.map((d) => `${d.aId}-${d.bId}:${d.aKills}/${d.bKills}`),
    ['1-3:1/0', '1-4:0/0', '2-3:0/0', '2-4:0/0'],
  );
});

test('computeMatchDuels: a kill between two players outside aIds/bIds is ignored', () => {
  const kills = [kill({ attacker: 5, victim: 6, weapon: 'ak47' })];
  const [duel] = computeMatchDuels(kills, [], [1], [2]);
  assert.equal(duel.aKills, 0);
  assert.equal(duel.bKills, 0);
  assert.deepEqual(duel.weaponBreakdown, []);
});

test('computeMatchDuels: sums damage each direction, ignoring damage outside the pair', () => {
  const damageEvents = [
    dmg({ attacker: 1, victim: 2, weapon: 'ak47', damage: 40 }),
    dmg({ attacker: 1, victim: 2, weapon: 'hegrenade', damage: 12 }),
    dmg({ attacker: 2, victim: 1, weapon: 'deagle', damage: 55 }),
    dmg({ attacker: 1, victim: 3, weapon: 'ak47', damage: 100 }),
  ];
  const [duel] = computeMatchDuels([], damageEvents, [1], [2]);
  assert.equal(duel.aDamage, 52);
  assert.equal(duel.bDamage, 55);
});

test('computeMatchDuels: buckets kills by weapon category, only including categories with a kill either way', () => {
  const kills = [
    kill({ attacker: 1, victim: 2, weapon: 'ak47' }),
    kill({ attacker: 1, victim: 2, weapon: 'm4a1' }),
    kill({ attacker: 2, victim: 1, weapon: 'deagle' }),
    kill({ attacker: 2, victim: 1, weapon: 'knife_karambit' }),
  ];
  const [duel] = computeMatchDuels(kills, [], [1], [2]);
  assert.deepEqual(duel.weaponBreakdown, [
    { category: 'pistol', aKills: [], bKills: [false] },
    { category: 'rifle', aKills: [false, false], bKills: [] },
    { category: 'melee', aKills: [], bKills: [false] },
  ]);
});

test('computeMatchDuels: each category kill list preserves headshot flags in round/tick order, not insertion order', () => {
  const kills = [
    kill({ round: 2, tick: 50, attacker: 1, victim: 2, weapon: 'ak47', headshot: false }),
    kill({ round: 1, tick: 200, attacker: 1, victim: 2, weapon: 'ak47', headshot: true }),
    kill({ round: 1, tick: 100, attacker: 1, victim: 2, weapon: 'ak47', headshot: false }),
  ];
  const [duel] = computeMatchDuels(kills, [], [1], [2]);
  const [rifle] = duel.weaponBreakdown;
  assert.equal(rifle.category, 'rifle');
  assert.deepEqual(rifle.aKills, [false, true, false]);
});

report();
