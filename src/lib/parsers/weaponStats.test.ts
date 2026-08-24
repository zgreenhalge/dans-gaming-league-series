/**
 * Unit tests for collectWeaponClassStats and collectEconomyStats — per-weapon-category and
 * per-round-economy shot/accuracy/damage/rounds breakdowns (#279).
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

function bucket(rows: WeaponBreakdownRow[], name: string): WeaponBreakdownRow | undefined {
  return rows.find((r) => r.bucket === name);
}

test('collectWeaponClassStats: rifle shots/hits/headshots/damage bucket under "rifle"', () => {
  const fires = [fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_ak47' })];
  const hurts = [hurt({ round: 1, tick: 105, victim: 'c', attacker: 'a', weapon: 'ak47', dmgHealth: 40, hitgroup: 'head' })];
  const ctx = makeContext({ rounds, sides });
  const out = collectWeaponClassStats(fires, hurts, ctx, ids);
  const rifle = bucket(out.get('a')!, 'rifle');
  assert.equal(rifle?.shots_fired, 1);
  assert.equal(rifle?.shots_hit, 1);
  assert.equal(rifle?.headshot_hits, 1);
  assert.equal(rifle?.damage_dealt, 40);
  assert.equal(rifle?.rounds_played, 1);
});

test('collectWeaponClassStats: a knife/grenade weapon is not categorized', () => {
  const fires = [fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_knife_push' })];
  const ctx = makeContext({ rounds, sides });
  const out = collectWeaponClassStats(fires, [], ctx, ids);
  assert.equal(out.get('a')!.length, 0);
});

test('collectWeaponClassStats: rounds_played counts distinct rounds fired, not shots', () => {
  const fires = [
    fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_glock' }),
    fire({ round: 1, tick: 110, user: 'a', weapon: 'weapon_glock' }),
    fire({ round: 2, tick: 1100, user: 'a', weapon: 'weapon_glock' }),
  ];
  const ctx = makeContext({ rounds, sides });
  const out = collectWeaponClassStats(fires, [], ctx, ids);
  const pistol = bucket(out.get('a')!, 'pistol');
  assert.equal(pistol?.shots_fired, 3);
  assert.equal(pistol?.rounds_played, 2);
});

test('collectWeaponClassStats: teamdamage is excluded from shots_hit/damage', () => {
  const fires = [fire({ round: 1, tick: 100, user: 'a', weapon: 'weapon_ak47' })];
  const hurts = [hurt({ round: 1, tick: 105, victim: 'b', attacker: 'a', weapon: 'ak47', dmgHealth: 40 })];
  const ctx = makeContext({ rounds, sides });
  const out = collectWeaponClassStats(fires, hurts, ctx, ids);
  const rifle = bucket(out.get('a')!, 'rifle');
  assert.equal(rifle?.shots_hit ?? 0, 0);
  assert.equal(rifle?.damage_dealt ?? 0, 0);
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
  const out = collectMatchKills(deaths, ctx, ids);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    round_number: 1,
    attacker_steamid: 'a',
    victim_steamid: 'c',
    assister_steamid: 'b',
    weapon: 'ak47',
    headshot: true,
    is_teamkill: false,
    tick: 105,
  });
});

test('collectMatchKills: a genuine duplicate death for the same (round, victim) keeps the first and warns', () => {
  // Both events are post-match-start and in-round here — this isn't the warmup-collision case
  // (see the dedicated test below), it's a demoparser2-level duplicate. That's a real anomaly, so
  // it must be visible (context.warnings, which gates auto-commit), not silently dropped.
  const deaths = [
    death({ round: 1, tick: 105, victim: 'c', attacker: 'a', weapon: 'ak47' }),
    death({ round: 1, tick: 950, victim: 'c', attacker: 'b', weapon: 'usp_silencer' }),
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectMatchKills(deaths, ctx, ids);
  assert.equal(out.length, 1);
  assert.equal(out[0].attacker_steamid, 'a');
  assert.equal(out[0].weapon, 'ak47');
  assert.equal(ctx.warnings.length, 1);
  assert.match(ctx.warnings[0], /Duplicate player_death for c in round 1/);
});

test('collectMatchKills: a warmup-period death is excluded by tick even when its round offset collides with a live round', () => {
  // The actual bug behind #452's missing match_kills rows: a warmup death with
  // total_rounds_played=0 (so total_rounds_played+1 === 1, a real live round number) landing
  // before matchStartTick. roundOf() now excludes it by tick, so it never reaches the
  // (round, victim) dedupe/warning path at all — there is exactly one real kill, no anomaly.
  const deaths = [
    death({ round: 1, tick: 50, victim: 'c', attacker: 'b', weapon: 'glock' }), // warmup, tick < matchStartTick
    death({ round: 1, tick: 105, victim: 'c', attacker: 'a', weapon: 'ak47' }), // the real round-1 kill
  ];
  const ctx = makeContext({ rounds, sides, deaths, matchStartTick: 100 });
  const out = collectMatchKills(deaths, ctx, ids);
  assert.equal(out.length, 1);
  assert.equal(out[0].attacker_steamid, 'a');
  assert.equal(out[0].weapon, 'ak47');
  assert.equal(ctx.warnings.length, 0);
});

test('collectMatchKills: the same victim dying in different rounds produces separate rows', () => {
  const deaths = [
    death({ round: 1, tick: 105, victim: 'c', attacker: 'a', weapon: 'ak47' }),
    death({ round: 2, tick: 1105, victim: 'c', attacker: 'b', weapon: 'usp_silencer' }),
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectMatchKills(deaths, ctx, ids);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.round_number), [1, 2]);
});

test('collectMatchKills: a death outside any live round is dropped', () => {
  const deaths = [death({ round: 99, tick: 50, victim: 'c', attacker: 'a', weapon: 'ak47' })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectMatchKills(deaths, ctx, ids);
  assert.equal(out.length, 0);
});

test('collectMatchKills: an unresolved attacker (world kill) is nulled, not dropped', () => {
  const deaths = [death({ round: 1, tick: 105, victim: 'c', attacker: null, weapon: 'world' })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectMatchKills(deaths, ctx, ids);
  assert.equal(out.length, 1);
  assert.equal(out[0].attacker_steamid, null);
  assert.equal(out[0].is_teamkill, false);
});

test('collectMatchKills: a same-faction kill is flagged is_teamkill', () => {
  const deaths = [death({ round: 1, tick: 105, victim: 'b', attacker: 'a', weapon: 'ak47' })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectMatchKills(deaths, ctx, ids);
  assert.equal(out.length, 1);
  assert.equal(out[0].is_teamkill, true);
});

report();
