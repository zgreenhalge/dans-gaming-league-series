/**
 * Unit tests for collectUtility — flash stats (blind_duration_dealt, teamflash_duration,
 * flash_assists, flashes_thrown, enemies_flashed). The flash-assist window math (blind expiry +
 * a fixed window) is the riskiest part: a boundary slip either double-counts or silently drops a
 * real assist. The half-blind threshold (1.1s) gates enemies_flashed/flash_assists but not
 * blind_duration_dealt, which stays a raw, ungated exposure measure.
 *
 * Run:  npx tsx src/lib/parsers/utility.test.ts
 */

import assert from 'node:assert/strict';
import { collectUtility, type PlayerBlindRow, type WeaponFireRow } from './utility';
import { makeContext, death } from './matchContextFixture';

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
  }
}

function blind(opts: { round: number; tick: number; attacker: string | null; user: string | null; duration: number }): PlayerBlindRow {
  return { tick: opts.tick, total_rounds_played: opts.round - 1, attacker_steamid: opts.attacker, user_steamid: opts.user, blind_duration: opts.duration };
}

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const ids = Object.keys(sides);
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];
const tickRate = 64;

test('collectUtility: flashing an enemy credits blind_duration_dealt to the flasher', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 1.5 })];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectUtility(blinds, [], [], ctx, ids);
  assert.equal(out.get('a')?.blind_duration_dealt, 1.5);
});

test('collectUtility: flashing a teammate credits teamflash_duration, not blind_duration_dealt', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'b', duration: 2 })]; // a, b both CT
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectUtility(blinds, [], [], ctx, ids);
  assert.equal(out.get('a')?.teamflash_duration, 2);
  assert.equal(out.get('a')?.blind_duration_dealt ?? 0, 0);
});

test('collectUtility: a self-flash is ignored entirely', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'a', duration: 2 })];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectUtility(blinds, [], [], ctx, ids);
  assert.equal(out.get('a')?.blind_duration_dealt ?? 0, 0);
  assert.equal(out.get('a')?.teamflash_duration ?? 0, 0);
});

test('collectUtility: a teammate finishing the blinded enemy inside the window counts as a flash assist', () => {
  // duration 1.1s (at the half-blind threshold) @ 64 tick -> blind expires at tick+70;
  // window is 3s (192 ticks) after that -> tick+262.
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 1.1 })];
  const deaths = [death({ round: 1, tick: 362, victim: 'c', attacker: 'b' })]; // b is a's CT teammate, at the exact window edge
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectUtility(blinds, deaths, [], ctx, ids);
  assert.equal(out.get('a')?.flash_assists, 1);
});

test('collectUtility: a kill one tick past the assist window does not count', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 1.1 })];
  const deaths = [death({ round: 1, tick: 363, victim: 'c', attacker: 'b' })];
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectUtility(blinds, deaths, [], ctx, ids);
  assert.equal(out.get('a')?.flash_assists ?? 0, 0);
});

test('collectUtility: the flasher finishing their own flashed enemy is a kill, not an assist — but does count as flashes_leading_to_kill', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 1.1 })];
  const deaths = [death({ round: 1, tick: 150, victim: 'c', attacker: 'a' })]; // a gets the kill themself, while c is still blinded
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectUtility(blinds, deaths, [], ctx, ids);
  assert.equal(out.get('a')?.flash_assists ?? 0, 0);
  assert.equal(out.get('a')?.flashes_leading_to_kill, 1);
});

test('collectUtility: flashes_leading_to_kill does not count a kill after the blind has expired', () => {
  // duration 1.1s @ 64 tick -> blind expires at tick+70 (170); this kill lands one tick later.
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 1.1 })];
  const deaths = [death({ round: 1, tick: 171, victim: 'c', attacker: 'a' })];
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectUtility(blinds, deaths, [], ctx, ids);
  assert.equal(out.get('a')?.flashes_leading_to_kill ?? 0, 0);
});

test('collectUtility: a half-blind kill does not count as flashes_leading_to_kill', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 1 })]; // below 1.1s threshold
  const deaths = [death({ round: 1, tick: 150, victim: 'c', attacker: 'a' })];
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectUtility(blinds, deaths, [], ctx, ids);
  assert.equal(out.get('a')?.flashes_leading_to_kill ?? 0, 0);
});

test('collectUtility: a blind at or above the 1.1s half-blind threshold counts as enemies_flashed', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 1.1 })];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectUtility(blinds, [], [], ctx, ids);
  assert.equal(out.get('a')?.enemies_flashed, 1);
});

test('collectUtility: a blind below the 1.1s half-blind threshold does not count as enemies_flashed', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 1.09 })];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectUtility(blinds, [], [], ctx, ids);
  assert.equal(out.get('a')?.enemies_flashed ?? 0, 0);
});

test('collectUtility: a half-blind still accumulates raw blind_duration_dealt', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 0.5 })];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectUtility(blinds, [], [], ctx, ids);
  assert.equal(out.get('a')?.blind_duration_dealt, 0.5);
  assert.equal(out.get('a')?.enemies_flashed ?? 0, 0);
});

test('collectUtility: a half-blind kill does not count as a flash assist even inside the window', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 1 })]; // below 1.1s threshold
  const deaths = [death({ round: 1, tick: 150, victim: 'c', attacker: 'b' })]; // b is a's CT teammate
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectUtility(blinds, deaths, [], ctx, ids);
  assert.equal(out.get('a')?.flash_assists ?? 0, 0);
});

test('collectUtility: one flash blinding two enemies counts as one effective flash, using the longest duration', () => {
  // Same (attacker, tick) = one detonation; c gets the longer blind, d the shorter.
  const blinds = [
    blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 2.5 }),
    blind({ round: 1, tick: 100, attacker: 'a', user: 'd', duration: 1.5 }),
  ];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectUtility(blinds, [], [], ctx, ids);
  assert.equal(out.get('a')?.effective_flashes, 1);
  assert.equal(out.get('a')?.blind_duration_max_sum, 2.5);
});

test('collectUtility: two separate flashes sum their own max durations', () => {
  const blinds = [
    blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 1.2 }),
    blind({ round: 1, tick: 500, attacker: 'a', user: 'd', duration: 3 }),
  ];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectUtility(blinds, [], [], ctx, ids);
  assert.equal(out.get('a')?.effective_flashes, 2);
  assert.equal(out.get('a')?.blind_duration_max_sum, 4.2);
});

test('collectUtility: a flash with only a sub-threshold blind is not an effective flash', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 0.8 })];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectUtility(blinds, [], [], ctx, ids);
  assert.equal(out.get('a')?.effective_flashes ?? 0, 0);
  assert.equal(out.get('a')?.blind_duration_max_sum ?? 0, 0);
});

test('collectUtility: flashes_thrown counts only weapon_flashbang fire events', () => {
  const fires: WeaponFireRow[] = [
    { tick: 100, total_rounds_played: 0, user_steamid: 'a', weapon: 'weapon_flashbang' },
    { tick: 150, total_rounds_played: 0, user_steamid: 'a', weapon: 'weapon_hegrenade' },
    { tick: 200, total_rounds_played: 0, user_steamid: 'a', weapon: 'weapon_flashbang' },
  ];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectUtility([], [], fires, ctx, ids);
  assert.equal(out.get('a')?.flashes_thrown, 2);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
