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
  resolveWeaponFilterStat,
  categoryFilterValue,
  parseCategoryFilter,
  deriveHeadshotAndTeamkillCounts,
  deriveOpeningDuelCounts,
  deriveTwoKRoundCounts,
  resolvePlayerSide,
  deriveSideSplitCounts,
  deriveClutchCounts,
  buildPlayerFactionsAndRoster,
  type MatchKillRow,
} from './queries/kills';
import type { RoundSideInfo } from './queries/rounds';
import { test, report } from './test-support/miniTest';

/** Shorthand for a `RoundSideInfo` test fixture — `winnerSide` defaults to `shirtsSide` (CT wins)
 *  since most tests here don't exercise the clutch win/loss branch. */
function ri(shirtsSide: 'CT' | 'T', winnerSide: 'CT' | 'T' = shirtsSide): RoundSideInfo {
  return { shirtsSide, winnerSide };
}

function kill(opts: {
  match?: number;
  round?: number;
  tick?: number;
  attacker: number | null;
  victim: number;
  weapon: string;
  assister?: number | null;
  headshot?: boolean;
  noscope?: boolean;
  wallbang?: boolean;
  blindKill?: boolean;
  midair?: boolean;
  isTeamkill?: boolean;
}): MatchKillRow {
  return {
    match_id: opts.match ?? 1,
    season_id: 1,
    round_number: opts.round ?? 1,
    attacker_player_id: opts.attacker,
    attacker_name: opts.attacker != null ? `p${opts.attacker}` : null,
    victim_player_id: opts.victim,
    victim_name: `p${opts.victim}`,
    assister_player_id: opts.assister ?? null,
    weapon: opts.weapon,
    headshot: opts.headshot ?? false,
    noscope: opts.noscope ?? false,
    wallbang: opts.wallbang ?? false,
    blind_kill: opts.blindKill ?? false,
    midair: opts.midair ?? false,
    is_teamkill: opts.isTeamkill ?? false,
    tick: opts.tick ?? 100,
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

test('aggregateWeaponKillStats/allWeaponsWithKills: every knife/bayonet variant merges into one "knife" bucket (#474)', () => {
  const kills = [
    kill({ attacker: 1, victim: 2, weapon: 'knife_karambit' }),
    kill({ attacker: 1, victim: 3, weapon: 'bayonet', headshot: false }),
    kill({ attacker: 4, victim: 1, weapon: 'knife_m9_bayonet' }),
  ];
  const stats = aggregateWeaponKillStats(kills, 1);
  const knifeEntries = stats.filter((s) => s.weapon === 'knife');
  assert.equal(knifeEntries.length, 1);
  assert.equal(knifeEntries[0].kills, 2);
  assert.equal(knifeEntries[0].deaths, 1);

  assert.deepEqual(allWeaponsWithKills(kills), ['knife']);
});

test('resolveWeaponFilterStat: null selection resolves the favorite weapon\'s display label', () => {
  const kills = [
    kill({ attacker: 1, victim: 2, weapon: 'ak47' }),
    kill({ attacker: 1, victim: 3, weapon: 'ak47' }),
  ];
  const stats = aggregateWeaponKillStats(kills, 1);
  const resolved = resolveWeaponFilterStat(stats, null);
  assert.equal(resolved.weapon, 'ak47');
  assert.equal(resolved.label, 'AK-47');
  assert.equal(resolved.kills, 2);
});

test('resolveWeaponFilterStat: a category filter rolls up every weapon in that category, with no single weapon', () => {
  const kills = [
    kill({ attacker: 1, victim: 2, weapon: 'ak47', headshot: true }),
    kill({ attacker: 1, victim: 3, weapon: 'm4a1_silencer' }),
    kill({ attacker: 1, victim: 4, weapon: 'deagle' }), // pistol, not rifle
  ];
  const stats = aggregateWeaponKillStats(kills, 1);
  const resolved = resolveWeaponFilterStat(stats, categoryFilterValue('rifle'));
  assert.equal(resolved.weapon, null);
  assert.equal(resolved.category, 'rifle');
  assert.equal(resolved.label, 'Rifles');
  assert.equal(resolved.kills, 2);
  assert.equal(resolved.headshotKills, 1);
});

test('resolveWeaponFilterStat: a category with no kills in scope still resolves a zeroed row, not null', () => {
  const stats = aggregateWeaponKillStats([kill({ attacker: 1, victim: 2, weapon: 'deagle' })], 1);
  const resolved = resolveWeaponFilterStat(stats, categoryFilterValue('sniper'));
  assert.equal(resolved.kills, 0);
  assert.equal(resolved.category, 'sniper');
});

test('parseCategoryFilter: round-trips categoryFilterValue(), and returns null for a plain weapon key or favorite', () => {
  assert.equal(parseCategoryFilter(categoryFilterValue('rifle')), 'rifle');
  assert.equal(parseCategoryFilter('ak47'), null);
  assert.equal(parseCategoryFilter(null), null);
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

test('deriveHeadshotAndTeamkillCounts: counts headshot kills, keyed by match and attacker', () => {
  const kills = [
    kill({ attacker: 1, victim: 2, weapon: 'ak47', headshot: true }),
    kill({ attacker: 1, victim: 3, weapon: 'ak47', headshot: true }),
    kill({ attacker: 1, victim: 4, weapon: 'ak47' }), // not a headshot
    kill({ attacker: 2, victim: 1, weapon: 'deagle', headshot: true }),
  ];
  const counts = deriveHeadshotAndTeamkillCounts(kills);
  assert.deepEqual(counts.get('1:1'), { headshot_kills: 2, teamkills: 0 });
  assert.deepEqual(counts.get('1:2'), { headshot_kills: 1, teamkills: 0 });
});

test('deriveHeadshotAndTeamkillCounts: a teamkill counts toward teamkills, never headshot_kills, even when headshot', () => {
  const kills = [
    kill({ attacker: 1, victim: 2, weapon: 'ak47', headshot: true, isTeamkill: true }),
  ];
  const counts = deriveHeadshotAndTeamkillCounts(kills);
  assert.deepEqual(counts.get('1:1'), { headshot_kills: 0, teamkills: 1 });
});

test('deriveHeadshotAndTeamkillCounts: a self-kill credits neither', () => {
  const kills = [kill({ attacker: 1, victim: 1, weapon: 'world', headshot: true })];
  const counts = deriveHeadshotAndTeamkillCounts(kills);
  assert.equal(counts.has('1:1'), false);
});

test('deriveHeadshotAndTeamkillCounts: an unresolved attacker (world kill) is skipped, not thrown on', () => {
  const kills = [kill({ attacker: null, victim: 1, weapon: 'world' })];
  const counts = deriveHeadshotAndTeamkillCounts(kills);
  assert.equal(counts.size, 0);
});

test('deriveHeadshotAndTeamkillCounts: the same attacker in different matches keys separately', () => {
  const kills = [
    kill({ match: 100, attacker: 1, victim: 2, weapon: 'ak47', headshot: true }),
    kill({ match: 200, attacker: 1, victim: 2, weapon: 'ak47', headshot: true }),
    kill({ match: 200, attacker: 1, victim: 3, weapon: 'ak47', headshot: true }),
  ];
  const counts = deriveHeadshotAndTeamkillCounts(kills);
  assert.deepEqual(counts.get('100:1'), { headshot_kills: 1, teamkills: 0 });
  assert.deepEqual(counts.get('200:1'), { headshot_kills: 2, teamkills: 0 });
});

test('deriveOpeningDuelCounts: the earliest death in a round credits the victim an opening death and the attacker an opening kill', () => {
  const kills = [
    kill({ round: 1, tick: 500, attacker: 1, victim: 2, weapon: 'ak47' }),
    kill({ round: 1, tick: 100, attacker: 3, victim: 4, weapon: 'usp_silencer' }), // earliest
  ];
  const counts = deriveOpeningDuelCounts(kills);
  assert.deepEqual(counts.get('1:4'), { opening_kills: 0, opening_deaths: 1 });
  assert.deepEqual(counts.get('1:3'), { opening_kills: 1, opening_deaths: 0 });
  assert.equal(counts.has('1:2'), false);
  assert.equal(counts.has('1:1'), false);
});

test('deriveOpeningDuelCounts: a teamkill opener credits the opening death but not an opening kill', () => {
  const kills = [kill({ round: 1, tick: 100, attacker: 1, victim: 2, weapon: 'ak47', isTeamkill: true })];
  const counts = deriveOpeningDuelCounts(kills);
  assert.deepEqual(counts.get('1:2'), { opening_kills: 0, opening_deaths: 1 });
  assert.equal(counts.has('1:1'), false);
});

test('deriveOpeningDuelCounts: a world/unattributed opener credits only the opening death', () => {
  const kills = [kill({ round: 1, tick: 100, attacker: null, victim: 2, weapon: 'world' })];
  const counts = deriveOpeningDuelCounts(kills);
  assert.deepEqual(counts.get('1:2'), { opening_kills: 0, opening_deaths: 1 });
});

test('deriveOpeningDuelCounts: a self-kill opener credits the opening death but not an opening kill', () => {
  const kills = [kill({ round: 1, tick: 100, attacker: 1, victim: 1, weapon: 'world' })];
  const counts = deriveOpeningDuelCounts(kills);
  assert.deepEqual(counts.get('1:1'), { opening_kills: 0, opening_deaths: 1 });
});

test('deriveOpeningDuelCounts: each round is scored independently, and matches key separately', () => {
  const kills = [
    kill({ match: 100, round: 1, tick: 100, attacker: 1, victim: 2, weapon: 'ak47' }),
    kill({ match: 100, round: 2, tick: 100, attacker: 2, victim: 1, weapon: 'ak47' }),
    kill({ match: 200, round: 1, tick: 100, attacker: 1, victim: 2, weapon: 'ak47' }),
  ];
  const counts = deriveOpeningDuelCounts(kills);
  assert.deepEqual(counts.get('100:1'), { opening_kills: 1, opening_deaths: 1 });
  assert.deepEqual(counts.get('100:2'), { opening_kills: 1, opening_deaths: 1 });
  assert.deepEqual(counts.get('200:1'), { opening_kills: 1, opening_deaths: 0 });
});

test('deriveTwoKRoundCounts: two non-teamkill kills by the same attacker in one round is a 2k round', () => {
  const kills = [
    kill({ round: 1, attacker: 1, victim: 2, weapon: 'ak47' }),
    kill({ round: 1, attacker: 1, victim: 3, weapon: 'ak47' }),
  ];
  const counts = deriveTwoKRoundCounts(kills);
  assert.equal(counts.get('1:1'), 1);
});

test('deriveTwoKRoundCounts: a single kill in a round is not a 2k round', () => {
  const kills = [kill({ round: 1, attacker: 1, victim: 2, weapon: 'ak47' })];
  const counts = deriveTwoKRoundCounts(kills);
  assert.equal(counts.has('1:1'), false);
});

test('deriveTwoKRoundCounts: a teamkill does not count toward the 2k, even alongside a real kill', () => {
  const kills = [
    kill({ round: 1, attacker: 1, victim: 2, weapon: 'ak47' }),
    kill({ round: 1, attacker: 1, victim: 3, weapon: 'ak47', isTeamkill: true }),
  ];
  const counts = deriveTwoKRoundCounts(kills);
  assert.equal(counts.has('1:1'), false);
});

test('deriveTwoKRoundCounts: a self-kill does not count toward the 2k, even alongside a real kill', () => {
  const kills = [
    kill({ round: 1, attacker: 1, victim: 2, weapon: 'ak47' }),
    kill({ round: 1, attacker: 1, victim: 1, weapon: 'world' }),
  ];
  const counts = deriveTwoKRoundCounts(kills);
  assert.equal(counts.has('1:1'), false);
});

test('deriveTwoKRoundCounts: 2k rounds accumulate across multiple rounds', () => {
  const kills = [
    kill({ round: 1, attacker: 1, victim: 2, weapon: 'ak47' }),
    kill({ round: 1, attacker: 1, victim: 3, weapon: 'ak47' }),
    kill({ round: 2, attacker: 1, victim: 2, weapon: 'ak47' }),
    kill({ round: 2, attacker: 1, victim: 3, weapon: 'ak47' }),
  ];
  const counts = deriveTwoKRoundCounts(kills);
  assert.equal(counts.get('1:1'), 2);
});

test('resolvePlayerSide: SHIRTS takes the round\'s shirts_side, SKINS takes the opposite', () => {
  assert.equal(resolvePlayerSide('CT', 'SHIRTS'), 'CT');
  assert.equal(resolvePlayerSide('CT', 'SKINS'), 'T');
  assert.equal(resolvePlayerSide('T', 'SHIRTS'), 'T');
  assert.equal(resolvePlayerSide('T', 'SKINS'), 'CT');
});

test('deriveSideSplitCounts: a credited kill splits by each participant\'s own resolved side', () => {
  const roundSides = new Map([['1:1', ri('CT')]]);
  const playerFactions = new Map([['1:1', 'SHIRTS' as const], ['1:2', 'SKINS' as const]]);
  const kills = [kill({ round: 1, attacker: 1, victim: 2, weapon: 'ak47' })];
  const counts = deriveSideSplitCounts(kills, roundSides, playerFactions);
  assert.equal(counts.get('1:1')?.kills_ct, 1);
  assert.equal(counts.get('1:1')?.kills_t, 0);
  assert.equal(counts.get('1:2')?.deaths_t, 1);
  assert.equal(counts.get('1:2')?.deaths_ct, 0);
});

test('deriveSideSplitCounts: a headshot kill credits both kills and headshot_kills on the same side', () => {
  const roundSides = new Map([['1:1', ri('T')]]);
  const playerFactions = new Map([['1:1', 'SKINS' as const], ['1:2', 'SHIRTS' as const]]);
  const kills = [kill({ round: 1, attacker: 1, victim: 2, weapon: 'ak47', headshot: true })];
  const counts = deriveSideSplitCounts(kills, roundSides, playerFactions);
  // SKINS on a T round resolves to CT.
  assert.equal(counts.get('1:1')?.kills_ct, 1);
  assert.equal(counts.get('1:1')?.headshot_kills_ct, 1);
});

test('deriveSideSplitCounts: a self-kill credits only a death, no kill', () => {
  const roundSides = new Map([['1:1', ri('CT')]]);
  const playerFactions = new Map([['1:1', 'SHIRTS' as const]]);
  const kills = [kill({ round: 1, attacker: 1, victim: 1, weapon: 'world' })];
  const counts = deriveSideSplitCounts(kills, roundSides, playerFactions);
  assert.equal(counts.get('1:1')?.deaths_ct, 1);
  assert.equal(counts.get('1:1')?.kills_ct ?? 0, 0);
  assert.equal(counts.get('1:1')?.kills_t ?? 0, 0);
});

test('deriveSideSplitCounts: a teamkill credits only a death, no kill or headshot', () => {
  const roundSides = new Map([['1:1', ri('CT')]]);
  const playerFactions = new Map([['1:1', 'SHIRTS' as const], ['1:2', 'SHIRTS' as const]]);
  const kills = [kill({ round: 1, attacker: 1, victim: 2, weapon: 'ak47', headshot: true, isTeamkill: true })];
  const counts = deriveSideSplitCounts(kills, roundSides, playerFactions);
  assert.equal(counts.get('1:2')?.deaths_ct, 1);
  assert.equal(counts.has('1:1'), false);
});

test('deriveSideSplitCounts: an assist credits the assister\'s own resolved side', () => {
  const roundSides = new Map([['1:1', ri('CT')]]);
  const playerFactions = new Map([
    ['1:1', 'SHIRTS' as const], ['1:2', 'SKINS' as const], ['1:3', 'SHIRTS' as const],
  ]);
  const kills = [kill({ round: 1, attacker: 1, victim: 2, weapon: 'ak47', assister: 3 })];
  const counts = deriveSideSplitCounts(kills, roundSides, playerFactions);
  assert.equal(counts.get('1:3')?.assists_ct, 1);
});

test('deriveSideSplitCounts: a round with no resolved shirts_side is skipped entirely', () => {
  const roundSides = new Map<string, RoundSideInfo>();
  const playerFactions = new Map([['1:1', 'SHIRTS' as const], ['1:2', 'SKINS' as const]]);
  const kills = [kill({ round: 1, attacker: 1, victim: 2, weapon: 'ak47' })];
  const counts = deriveSideSplitCounts(kills, roundSides, playerFactions);
  assert.equal(counts.size, 0);
});

test('deriveSideSplitCounts: a player with no resolved faction is skipped, other participants unaffected', () => {
  const roundSides = new Map([['1:1', ri('CT')]]);
  const playerFactions = new Map([['1:2', 'SKINS' as const]]); // attacker (player 1) missing
  const kills = [kill({ round: 1, attacker: 1, victim: 2, weapon: 'ak47' })];
  const counts = deriveSideSplitCounts(kills, roundSides, playerFactions);
  assert.equal(counts.has('1:1'), false);
  assert.equal(counts.get('1:2')?.deaths_t, 1);
});

// ─── deriveClutchCounts ─────────────────────────────────────────────────────
// Ports every scenario from parsers/clutch.test.ts (collectClutch's own unit tests) to prove the
// query-time reconstruction produces identical results to the live parser it replaces. Player names
// (a, b, c, ...) map to numeric ids below; every scenario fixes shirts_side to CT for the one round
// under test and assigns each player's faction so resolvePlayerSide() reproduces the same starting
// CT/T sides the original tests specify directly.
const PLAYER_IDS: Record<string, number> = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };

function clutchFixture(sides: Record<string, 'CT' | 'T'>, winnerSide: 'CT' | 'T') {
  const roundSides = new Map([['1:1', ri('CT', winnerSide)]]);
  const playerFactions = new Map<string, 'SHIRTS' | 'SKINS'>();
  const roster: number[] = [];
  for (const [name, side] of Object.entries(sides)) {
    const id = PLAYER_IDS[name];
    roster.push(id);
    playerFactions.set(`1:${id}`, side === 'CT' ? 'SHIRTS' : 'SKINS');
  }
  return { roundSides, playerFactions, rosterByMatch: new Map([[1, roster]]) };
}

function clutchDeath(tick: number, victim: string): MatchKillRow {
  return kill({ round: 1, tick, attacker: 999, victim: PLAYER_IDS[victim], weapon: 'ak47' });
}

test('deriveClutchCounts: a 1v2 clutcher who fights down to a 1v1 keeps the 1v2 credit and also picks up the 1v1', () => {
  const { roundSides, playerFactions, rosterByMatch } =
    clutchFixture({ a: 'CT', b: 'CT', c: 'T', d: 'T' }, 'CT');
  const kills = [clutchDeath(100, 'c'), clutchDeath(200, 'b')];
  const counts = deriveClutchCounts(kills, roundSides, playerFactions, rosterByMatch);

  assert.equal(counts.get('1:4')?.clutch_1v2_attempts, 1);
  assert.equal(counts.get('1:4')?.clutch_1v2_wins ?? 0, 0);
  assert.equal(counts.get('1:4')?.clutch_1v1_attempts, 1);
  assert.equal(counts.get('1:4')?.clutch_1v1_wins ?? 0, 0);
  assert.equal(counts.get('1:1')?.clutch_1v1_attempts, 1);
  assert.equal(counts.get('1:1')?.clutch_1v1_wins, 1);
});

test('deriveClutchCounts: enemy count > 2 is not tracked at all', () => {
  const { roundSides, playerFactions, rosterByMatch } =
    clutchFixture({ a: 'CT', b: 'CT', c: 'CT', d: 'CT', e: 'T', f: 'T', g: 'T', h: 'T' }, 'CT');
  const kills = [clutchDeath(100, 'f'), clutchDeath(200, 'g'), clutchDeath(300, 'h')];
  const counts = deriveClutchCounts(kills, roundSides, playerFactions, rosterByMatch);

  assert.equal(counts.get('1:5')?.clutch_1v1_attempts ?? 0, 0);
  assert.equal(counts.get('1:5')?.clutch_1v2_attempts ?? 0, 0);
});

test('deriveClutchCounts: a 1v2 that narrows to a 1v1 credits both the 1v2 attempt and the later 1v1', () => {
  const { roundSides, playerFactions, rosterByMatch } =
    clutchFixture({ a: 'CT', b: 'CT', c: 'T', d: 'T' }, 'CT');
  const kills = [clutchDeath(100, 'b'), clutchDeath(200, 'c')];
  const counts = deriveClutchCounts(kills, roundSides, playerFactions, rosterByMatch);

  assert.equal(counts.get('1:1')?.clutch_1v2_attempts, 1);
  assert.equal(counts.get('1:1')?.clutch_1v2_wins, 1);
  assert.equal(counts.get('1:1')?.clutch_1v1_attempts, 1);
  assert.equal(counts.get('1:1')?.clutch_1v1_wins, 1);
});

test('deriveClutchCounts: nobody down to a lone survivor yet means no clutch at all', () => {
  const { roundSides, playerFactions, rosterByMatch } =
    clutchFixture({ a: 'CT', b: 'CT', c: 'CT', d: 'T', e: 'T', f: 'T' }, 'CT');
  const kills = [clutchDeath(100, 'f')];
  const counts = deriveClutchCounts(kills, roundSides, playerFactions, rosterByMatch);

  for (const name of Object.keys(PLAYER_IDS).slice(0, 6)) {
    const key = `1:${PLAYER_IDS[name]}`;
    assert.equal(counts.get(key)?.clutch_1v1_attempts ?? 0, 0);
    assert.equal(counts.get(key)?.clutch_1v2_attempts ?? 0, 0);
  }
});

test('deriveClutchCounts: a 2v1 numbers advantage is credited as a loss for both alive teammates when the round is lost', () => {
  const { roundSides, playerFactions, rosterByMatch } =
    clutchFixture({ a: 'CT', b: 'CT', c: 'T', d: 'T' }, 'T');
  const kills = [clutchDeath(100, 'd')];
  const counts = deriveClutchCounts(kills, roundSides, playerFactions, rosterByMatch);

  assert.equal(counts.get('1:1')?.clutch_2v1_attempts, 1);
  assert.equal(counts.get('1:1')?.clutch_2v1_wins ?? 0, 0);
  assert.equal(counts.get('1:2')?.clutch_2v1_attempts, 1);
  assert.equal(counts.get('1:2')?.clutch_2v1_wins ?? 0, 0);
});

test('deriveClutchCounts: a 2v1 numbers advantage is credited as a win for both alive teammates when the round is won', () => {
  const { roundSides, playerFactions, rosterByMatch } =
    clutchFixture({ a: 'CT', b: 'CT', c: 'T', d: 'T' }, 'CT');
  const kills = [clutchDeath(100, 'd')];
  const counts = deriveClutchCounts(kills, roundSides, playerFactions, rosterByMatch);

  assert.equal(counts.get('1:1')?.clutch_2v1_attempts, 1);
  assert.equal(counts.get('1:1')?.clutch_2v1_wins, 1);
  assert.equal(counts.get('1:2')?.clutch_2v1_attempts, 1);
  assert.equal(counts.get('1:2')?.clutch_2v1_wins, 1);
});

test('deriveClutchCounts: blowing a 2v1 advantage down to a 1v1 credits both the 2v1 attempt and the later 1v1 clutch', () => {
  const { roundSides, playerFactions, rosterByMatch } =
    clutchFixture({ a: 'CT', b: 'CT', c: 'T', d: 'T' }, 'CT');
  const kills = [clutchDeath(100, 'd'), clutchDeath(200, 'b')];
  const counts = deriveClutchCounts(kills, roundSides, playerFactions, rosterByMatch);

  assert.equal(counts.get('1:1')?.clutch_2v1_attempts, 1);
  assert.equal(counts.get('1:2')?.clutch_2v1_attempts, 1);
  assert.equal(counts.get('1:1')?.clutch_1v1_attempts, 1);
  assert.equal(counts.get('1:1')?.clutch_1v1_wins, 1);
});

test('deriveClutchCounts: a player outnumbered 3+ is not locked out of a real 1v2 once teammates trim the enemy count', () => {
  const { roundSides, playerFactions, rosterByMatch } =
    clutchFixture({ a: 'CT', e: 'T', f: 'T', g: 'T', h: 'T' }, 'CT');
  const kills = [clutchDeath(100, 'f'), clutchDeath(200, 'g')];
  const counts = deriveClutchCounts(kills, roundSides, playerFactions, rosterByMatch);

  assert.equal(counts.get('1:1')?.clutch_1v2_attempts, 1);
  assert.equal(counts.get('1:1')?.clutch_1v2_wins, 1);
});

test('buildPlayerFactionsAndRoster: builds both maps in one pass, grouping rosters per match', () => {
  const rows = [
    { match_id: 1, player_id: 1, faction: 'SHIRTS' as const },
    { match_id: 1, player_id: 2, faction: 'SKINS' as const },
    { match_id: 2, player_id: 3, faction: 'SHIRTS' as const },
  ];
  const { playerFactions, rosterByMatch } = buildPlayerFactionsAndRoster(rows);
  assert.equal(playerFactions.get('1:1'), 'SHIRTS');
  assert.equal(playerFactions.get('1:2'), 'SKINS');
  assert.equal(playerFactions.get('2:3'), 'SHIRTS');
  assert.deepEqual(rosterByMatch.get(1), [1, 2]);
  assert.deepEqual(rosterByMatch.get(2), [3]);
});

report();
