/**
 * Unit tests for queries/kills.ts's pure aggregation helpers (#452) — aggregateWeaponKillStats,
 * favoriteWeapon, allWeaponsWithKills, resolveWeaponStat. These operate on already-joined
 * `MatchKillRow[]` in memory, so no fake-DB harness is needed (contrast queries-weaponStats.test.ts,
 * which exercises an actual Supabase join).
 *
 * Run:  npx vitest run src/lib/queries-kills.test.ts
 */

import assert from 'node:assert/strict';
import {
  aggregateWeaponKillStats,
  aggregateFlairKillStats,
  favoriteWeapon,
  allWeaponsWithKills,
  resolveWeaponStat,
  type MatchKillRow,
} from './queries/kills';
import { test, report } from './test-support/miniTest';

function kill(opts: {
  attacker: number | null;
  victim: number;
  weapon: string;
  headshot?: boolean;
  noscope?: boolean;
  wallbang?: boolean;
  blindKill?: boolean;
  midair?: boolean;
  isTeamkill?: boolean;
}): MatchKillRow {
  return {
    match_id: 1,
    season_id: 1,
    round_number: 1,
    attacker_player_id: opts.attacker,
    attacker_name: opts.attacker != null ? `p${opts.attacker}` : null,
    victim_player_id: opts.victim,
    victim_name: `p${opts.victim}`,
    assister_player_id: null,
    weapon: opts.weapon,
    headshot: opts.headshot ?? false,
    noscope: opts.noscope ?? false,
    wallbang: opts.wallbang ?? false,
    blind_kill: opts.blindKill ?? false,
    midair: opts.midair ?? false,
    is_teamkill: opts.isTeamkill ?? false,
  };
}

test('aggregateWeaponKillStats: buckets kills/headshots/deaths per weapon for one player', () => {
  const kills = [
    kill({ attacker: 1, victim: 2, weapon: 'ak47', headshot: true }),
    kill({ attacker: 1, victim: 2, weapon: 'ak47' }),
    kill({ attacker: 1, victim: 3, weapon: 'usp_silencer' }),
    kill({ attacker: 2, victim: 1, weapon: 'deagle' }),
  ];
  const stats = aggregateWeaponKillStats(kills, 1);
  const ak = stats.find((s) => s.weapon === 'ak47');
  assert.equal(ak?.kills, 2);
  assert.equal(ak?.headshotKills, 1);
  assert.equal(ak?.noscopeKills, 0);
  assert.equal(ak?.wallbangKills, 0);
  assert.equal(ak?.blindKills, 0);
  const usp = stats.find((s) => s.weapon === 'usp_silencer');
  assert.equal(usp?.kills, 1);
  const deagle = stats.find((s) => s.weapon === 'deagle');
  assert.equal(deagle?.kills ?? 0, 0);
  assert.equal(deagle?.deaths, 1);
});

test('aggregateWeaponKillStats: self-kills and teamkills count as a death but not a credited kill', () => {
  const kills = [
    kill({ attacker: 1, victim: 1, weapon: 'world' }),
    kill({ attacker: 2, victim: 3, weapon: 'ak47', isTeamkill: true }),
  ];
  const selfKillStats = aggregateWeaponKillStats(kills, 1);
  assert.equal(selfKillStats.find((s) => s.weapon === 'world')?.kills ?? 0, 0);
  assert.equal(selfKillStats.find((s) => s.weapon === 'world')?.deaths, 1);

  const teamkillerStats = aggregateWeaponKillStats(kills, 2);
  assert.equal(teamkillerStats.length, 0);
  const victimStats = aggregateWeaponKillStats(kills, 3);
  assert.equal(victimStats.find((s) => s.weapon === 'ak47')?.deaths, 1);
});

test('favoriteWeapon: picks the weapon with the most kills, null when there are none', () => {
  const kills = [
    kill({ attacker: 1, victim: 2, weapon: 'ak47' }),
    kill({ attacker: 1, victim: 3, weapon: 'ak47' }),
    kill({ attacker: 1, victim: 4, weapon: 'usp_silencer' }),
  ];
  const stats = aggregateWeaponKillStats(kills, 1);
  assert.equal(favoriteWeapon(stats)?.weapon, 'ak47');
  assert.equal(favoriteWeapon(aggregateWeaponKillStats(kills, 5)), null);
});

test('allWeaponsWithKills: distinct credited-kill weapons, sorted by total kills descending, excludes teamkills/self-kills', () => {
  const kills = [
    kill({ attacker: 1, victim: 2, weapon: 'usp_silencer' }),
    kill({ attacker: 2, victim: 3, weapon: 'ak47' }),
    kill({ attacker: 2, victim: 4, weapon: 'ak47' }),
    kill({ attacker: 3, victim: 3, weapon: 'world' }),
    kill({ attacker: 4, victim: 1, weapon: 'deagle', isTeamkill: true }),
  ];
  assert.deepEqual(allWeaponsWithKills(kills), ['ak47', 'usp_silencer']);
});

test('resolveWeaponStat: null selection returns the favorite; a named selection returns that weapon zeroed if absent', () => {
  const kills = [
    kill({ attacker: 1, victim: 2, weapon: 'ak47' }),
    kill({ attacker: 1, victim: 3, weapon: 'ak47' }),
  ];
  const stats = aggregateWeaponKillStats(kills, 1);

  assert.equal(resolveWeaponStat(stats, null)?.weapon, 'ak47');

  const named = resolveWeaponStat(stats, 'ak47');
  assert.equal(named?.kills, 2);

  const absent = resolveWeaponStat(stats, 'usp_silencer');
  assert.deepEqual(absent, {
    weapon: 'usp_silencer',
    category: 'pistol',
    kills: 0,
    headshotKills: 0,
    noscopeKills: 0,
    wallbangKills: 0,
    blindKills: 0,
    midairKills: 0,
    deaths: 0,
  });
});

test('aggregateWeaponKillStats: buckets noscope/wallbang/blind/midair kills per weapon for one player', () => {
  const kills = [
    kill({ attacker: 1, victim: 2, weapon: 'awp', noscope: true }),
    kill({ attacker: 1, victim: 3, weapon: 'ak47', wallbang: true }),
    kill({ attacker: 1, victim: 4, weapon: 'ak47', blindKill: true }),
    kill({ attacker: 1, victim: 5, weapon: 'deagle', midair: true }),
  ];
  const stats = aggregateWeaponKillStats(kills, 1);
  const awp = stats.find((s) => s.weapon === 'awp');
  assert.equal(awp?.noscopeKills, 1);
  const ak = stats.find((s) => s.weapon === 'ak47');
  assert.equal(ak?.wallbangKills, 1);
  assert.equal(ak?.blindKills, 1);
  const deagle = stats.find((s) => s.weapon === 'deagle');
  assert.equal(deagle?.midairKills, 1);
});

test('aggregateFlairKillStats: totals noscope/wallbang/blind/midair across every weapon, plus knife kills', () => {
  const kills = [
    kill({ attacker: 1, victim: 2, weapon: 'awp', noscope: true }),
    kill({ attacker: 1, victim: 3, weapon: 'deagle', noscope: true }),
    kill({ attacker: 1, victim: 4, weapon: 'ak47', wallbang: true }),
    kill({ attacker: 1, victim: 5, weapon: 'usp_silencer', blindKill: true }),
    kill({ attacker: 1, victim: 8, weapon: 'deagle', midair: true }),
    kill({ attacker: 1, victim: 6, weapon: 'knife' }),
    kill({ attacker: 1, victim: 7, weapon: 'knife' }),
    kill({ attacker: 2, victim: 1, weapon: 'knife' }),
  ];
  const flair = aggregateFlairKillStats(kills, 1);
  assert.deepEqual(flair, { noscopeKills: 2, wallbangKills: 1, blindKills: 1, midairKills: 1, knifeKills: 2 });
});

report();
