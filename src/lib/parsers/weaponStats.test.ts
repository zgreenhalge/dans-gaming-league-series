/**
 * Unit tests for collectWeaponClassStats and collectEconomyStats — per-weapon (#279, #474) and
 * per-round-economy shot/accuracy/damage/rounds breakdowns.
 *
 * Run:  npx vitest run src/lib/parsers/weaponStats.test.ts
 */

import assert from 'node:assert/strict';
import { collectWeaponClassStats, collectEconomyStats, collectMatchKills, type WeaponBreakdownRow } from './weaponStats';
import { makeContext, hurt, death } from './matchContextFixture';
import type { WeaponFireRow } from './utility';
import type { EconomyType } from './economy';
import { test, report } from '../test-support/miniTest';

function fire(opts: { round: number; tick: number; user: string | null; weapon: string }): WeaponFireRow {
  return { tick: opts.tick, total_rounds_played: opts.round - 1, user_steamid: opts.user, weapon: opts.weapon };
}

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const ids = Object.keys(sides);
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }, { roundNumber: 2, winnerSide: 'T' as const }];
/** No mid-air kills in scope — most `collectMatchKills` tests don't care about it. */
const NO_MIDAIR = new Map<string, boolean>();

function bucket(rows: WeaponBreakdownRow[], name: string): WeaponBreakdownRow | undefined {
  return rows.find((r) => r.bucket === name);
}

test('collectWeaponClassStats: rifle shots/hits/headshots/damage bucket under the exact weapon ("ak47")', () => {
  const fires = [fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_ak47' })];
  const hurts = [hurt({ round: 1, tick: 105, victim: 'c', attacker: 'a', weapon: 'ak47', dmgHealth: 40, hitgroup: 'head' })];
  const ctx = makeContext({ rounds, sides });
  const out = collectWeaponClassStats(fires, hurts, ctx, ids);
  const ak47 = bucket(out.get('a')!, 'ak47');
  assert.equal(ak47?.shots_fired, 1);
  assert.equal(ak47?.shots_hit, 1);
  assert.equal(ak47?.headshot_hits, 1);
  assert.equal(ak47?.damage_dealt, 40);
  assert.equal(ak47?.rounds_played, 1);
});

test('collectWeaponClassStats: a knife/grenade weapon is not bucketed at all', () => {
  const fires = [fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_knife_push' })];
  const ctx = makeContext({ rounds, sides });
  const out = collectWeaponClassStats(fires, [], ctx, ids);
  assert.equal(out.get('a')!.length, 0);
});

test('collectWeaponClassStats: two different weapons in the same category stay in separate buckets', () => {
  const fires = [
    fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_ak47' }),
    fire({ round: 1, tick: 110, user: 'a', weapon: 'weapon_m4a1' }),
  ];
  const ctx = makeContext({ rounds, sides });
  const out = collectWeaponClassStats(fires, [], ctx, ids);
  assert.equal(bucket(out.get('a')!, 'ak47')?.shots_fired, 1);
  assert.equal(bucket(out.get('a')!, 'm4a1')?.shots_fired, 1);
});

test('collectWeaponClassStats: rounds_played counts distinct rounds fired, not shots', () => {
  const fires = [
    fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_glock' }),
    fire({ round: 1, tick: 110, user: 'a', weapon: 'weapon_glock' }),
    fire({ round: 2, tick: 1100, user: 'a', weapon: 'weapon_glock' }),
  ];
  const ctx = makeContext({ rounds, sides });
  const out = collectWeaponClassStats(fires, [], ctx, ids);
  const glock = bucket(out.get('a')!, 'glock');
  assert.equal(glock?.shots_fired, 3);
  assert.equal(glock?.rounds_played, 2);
});

test('collectWeaponClassStats: teamdamage is excluded from shots_hit/damage', () => {
  const fires = [fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_ak47' })];
  const hurts = [hurt({ round: 1, tick: 105, victim: 'b', attacker: 'a', weapon: 'ak47', dmgHealth: 40 })];
  const ctx = makeContext({ rounds, sides });
  const out = collectWeaponClassStats(fires, hurts, ctx, ids);
  const ak47 = bucket(out.get('a')!, 'ak47');
  assert.equal(ak47?.shots_hit ?? 0, 0);
  assert.equal(ak47?.damage_dealt ?? 0, 0);
});

test('collectEconomyStats: rounds_played is seeded from classification, even with zero shots', () => {
  const roundEconomy = new Map<string, Map<number, EconomyType>>([
    ['a', new Map([[1, 'eco'], [2, 'full_buy']])],
  ]);
  const ctx = makeContext({ rounds, sides });
  const out = collectEconomyStats([], [], roundEconomy, ctx, ids);
  const eco = bucket(out.get('a')!, 'eco');
  const full = bucket(out.get('a')!, 'full_buy');
  assert.equal(eco?.rounds_played, 1);
  assert.equal(eco?.shots_fired ?? 0, 0);
  assert.equal(full?.rounds_played, 1);
});

test('collectEconomyStats: shots/hits/damage bucket into the round\'s own economy tier', () => {
  const roundEconomy = new Map<string, Map<number, EconomyType>>([
    ['a', new Map([[1, 'eco']])],
  ]);
  const fires = [fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_glock' })];
  const hurts = [hurt({ round: 1, tick: 105, victim: 'c', attacker: 'a', weapon: 'glock', dmgHealth: 25 })];
  const ctx = makeContext({ rounds, sides });
  const out = collectEconomyStats(fires, hurts, roundEconomy, ctx, ids);
  const eco = bucket(out.get('a')!, 'eco');
  assert.equal(eco?.shots_fired, 1);
  assert.equal(eco?.shots_hit, 1);
  assert.equal(eco?.damage_dealt, 25);
});

test('collectMatchKills: one row per death, with resolved attacker/victim/assister/weapon', () => {
  const deaths = [death({ round: 1, tick: 105, victim: 'c', attacker: 'a', assister: 'b', headshot: true, weapon: 'ak47' })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectMatchKills(deaths, ctx, ids, NO_MIDAIR);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    round_number: 1,
    attacker_steamid: 'a',
    victim_steamid: 'c',
    assister_steamid: 'b',
    weapon: 'ak47',
    headshot: true,
    noscope: false,
    wallbang: false,
    blind_kill: false,
    midair: false,
    is_teamkill: false,
    tick: 105,
  });
});

test('collectMatchKills: wallbang is true when the bullet penetrated a surface', () => {
  const deaths = [death({ round: 1, tick: 105, victim: 'c', attacker: 'a', weapon: 'ak47', penetrated: 1 })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectMatchKills(deaths, ctx, ids, NO_MIDAIR);
  assert.equal(out[0].wallbang, true);
});

test('collectMatchKills: noscope and blind_kill pass through from the death event', () => {
  const deaths = [
    death({ round: 1, tick: 105, victim: 'c', attacker: 'a', weapon: 'awp', noscope: true, attackerblind: true }),
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectMatchKills(deaths, ctx, ids, NO_MIDAIR);
  assert.equal(out[0].noscope, true);
  assert.equal(out[0].blind_kill, true);
});

test('collectMatchKills: midair looks up the attacker\'s airborne state at the kill\'s own tick', () => {
  const deaths = [death({ round: 1, tick: 105, victim: 'c', attacker: 'a', weapon: 'ak47' })];
  const ctx = makeContext({ rounds, sides, deaths });
  const airborne = new Map<string, boolean>([['105:a', true]]);
  const out = collectMatchKills(deaths, ctx, ids, airborne);
  assert.equal(out[0].midair, true);

  const grounded = collectMatchKills(deaths, ctx, ids, new Map([['105:a', false]]));
  assert.equal(grounded[0].midair, false);

  // A tick with no entry (attacker's airborne state wasn't captured) defaults to false.
  assert.equal(collectMatchKills(deaths, ctx, ids, NO_MIDAIR)[0].midair, false);
});

test('collectMatchKills: trusts its input for (round, victim) uniqueness — dedup is dedupeDeathEvents()\'s job, not this collector\'s', () => {
  // demoOrchestrator.ts always runs dedupeDeathEvents() (matchContext.ts) before this collector,
  // so in production it never actually sees two events for the same (round, victim). This test
  // documents that collectMatchKills doesn't re-guard that invariant itself — see matchContext.test.ts
  // for the dedup/warning behavior itself.
  const deaths = [
    death({ round: 1, tick: 105, victim: 'c', attacker: 'a', weapon: 'ak47' }),
    death({ round: 1, tick: 950, victim: 'c', attacker: 'b', weapon: 'usp_silencer' }),
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectMatchKills(deaths, ctx, ids, NO_MIDAIR);
  assert.equal(out.length, 2);
});

test('collectMatchKills: the same victim dying in different rounds produces separate rows', () => {
  const deaths = [
    death({ round: 1, tick: 105, victim: 'c', attacker: 'a', weapon: 'ak47' }),
    death({ round: 2, tick: 1105, victim: 'c', attacker: 'b', weapon: 'usp_silencer' }),
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectMatchKills(deaths, ctx, ids, NO_MIDAIR);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.round_number), [1, 2]);
});

test('collectMatchKills: a death outside any live round is dropped', () => {
  const deaths = [death({ round: 99, tick: 50, victim: 'c', attacker: 'a', weapon: 'ak47' })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectMatchKills(deaths, ctx, ids, NO_MIDAIR);
  assert.equal(out.length, 0);
});

test('collectMatchKills: an unresolved attacker (world kill) is nulled, not dropped', () => {
  const deaths = [death({ round: 1, tick: 105, victim: 'c', attacker: null, weapon: 'world' })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectMatchKills(deaths, ctx, ids, NO_MIDAIR);
  assert.equal(out.length, 1);
  assert.equal(out[0].attacker_steamid, null);
  assert.equal(out[0].is_teamkill, false);
});

test('collectMatchKills: a same-faction kill is flagged is_teamkill', () => {
  const deaths = [death({ round: 1, tick: 105, victim: 'b', attacker: 'a', weapon: 'ak47' })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectMatchKills(deaths, ctx, ids, NO_MIDAIR);
  assert.equal(out.length, 1);
  assert.equal(out[0].is_teamkill, true);
});

report();
