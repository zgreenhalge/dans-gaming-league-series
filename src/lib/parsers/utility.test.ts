/**
 * Unit tests for collectUtility — flash stats (blind_duration_dealt, teamflash_duration,
 * flash_assists, flashes_thrown). The flash-assist window math (blind expiry + a fixed window) is
 * the riskiest part: a boundary slip either double-counts or silently drops a real assist.
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
  // duration 1s @ 64 tick -> blind expires at tick+64; window is 3s (192 ticks) after that -> tick+256.
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 1 })];
  const deaths = [death({ round: 1, tick: 356, victim: 'c', attacker: 'b' })]; // b is a's CT teammate, at the exact window edge
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectUtility(blinds, deaths, [], ctx, ids);
  assert.equal(out.get('a')?.flash_assists, 1);
});

test('collectUtility: a kill one tick past the assist window does not count', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 1 })];
  const deaths = [death({ round: 1, tick: 357, victim: 'c', attacker: 'b' })];
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectUtility(blinds, deaths, [], ctx, ids);
  assert.equal(out.get('a')?.flash_assists ?? 0, 0);
});

test('collectUtility: the flasher finishing their own flashed enemy is a kill, not an assist', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 1 })];
  const deaths = [death({ round: 1, tick: 150, victim: 'c', attacker: 'a' })]; // a gets the kill themself
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectUtility(blinds, deaths, [], ctx, ids);
  assert.equal(out.get('a')?.flash_assists ?? 0, 0);
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
