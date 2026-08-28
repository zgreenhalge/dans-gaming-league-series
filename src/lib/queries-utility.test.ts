/**
 * Unit tests for queries/utility.ts's deriveUtilityCounts() — the query-time replacement for
 * parsers/utility.ts's collectUtility() flash-effectiveness logic (#489). Ported 1:1 from that
 * collector's own removed unit tests (parsers/utility.test.ts), translated from steamid/MatchContext
 * inputs to the player_id/Faction-map inputs deriveUtilityCounts() actually takes — same tick math,
 * same boundary values, same expected outcomes. The flash-assist window (blind expiry + a fixed
 * window) and the flashes_leading_to_kill window (blind start through half the flash's own duration
 * past expiry) are the riskiest parts: a boundary slip either double-counts or silently drops a real
 * assist/kill credit. The half-blind threshold (1.1s) gates enemies_flashed/flash_assists but not
 * blind_duration_dealt, which stays a raw, ungated exposure measure.
 *
 * Run:  npx vitest run src/lib/queries-utility.test.ts
 */

import assert from 'node:assert/strict';
import { deriveUtilityCounts, lookupUtilityCounts, type UtilityThrowRow } from './queries/utility';
import type { KillCreditFlags } from './queries/kills';
import type { Faction } from './types';
import { test, report } from './test-support/miniTest';

// 1/2 SHIRTS (teammates), 3/4 SKINS (teammates), matching the old fixture's a/b CT vs c/d T split —
// deriveUtilityCounts() only cares about faction equality, not CT/T side.
const FACTIONS = new Map<string, Faction>([
  ['1:1', 'SHIRTS'], ['1:2', 'SHIRTS'], ['1:3', 'SKINS'], ['1:4', 'SKINS'],
]);

function throwRow(opts: { round?: number; tick: number; flasher: number; blinded: number; duration: number }): UtilityThrowRow {
  return {
    match_id: 1, round_number: opts.round ?? 1, tick: opts.tick,
    flasher_player_id: opts.flasher, blinded_player_id: opts.blinded, blind_duration: opts.duration,
  };
}

function death(opts: { round?: number; tick: number; victim: number; attacker: number | null }): KillCreditFlags {
  return {
    match_id: 1, round_number: opts.round ?? 1, tick: opts.tick,
    attacker_player_id: opts.attacker, victim_player_id: opts.victim,
    assister_player_id: null, headshot: false, is_teamkill: false,
  };
}

test('deriveUtilityCounts: flashing an enemy credits blind_duration_dealt to the flasher', () => {
  const out = deriveUtilityCounts([throwRow({ tick: 100, flasher: 1, blinded: 3, duration: 1.5 })], [], FACTIONS);
  assert.equal(lookupUtilityCounts('1:1', out).blind_duration_dealt, 1.5);
});

test('deriveUtilityCounts: flashing a teammate credits teamflash_duration, not blind_duration_dealt', () => {
  const out = deriveUtilityCounts([throwRow({ tick: 100, flasher: 1, blinded: 2, duration: 2 })], [], FACTIONS);
  assert.equal(lookupUtilityCounts('1:1', out).teamflash_duration, 2);
  assert.equal(lookupUtilityCounts('1:1', out).blind_duration_dealt, 0);
});

test('deriveUtilityCounts: a self-flash is ignored entirely', () => {
  const out = deriveUtilityCounts([throwRow({ tick: 100, flasher: 1, blinded: 1, duration: 2 })], [], FACTIONS);
  const c = lookupUtilityCounts('1:1', out);
  assert.equal(c.blind_duration_dealt, 0);
  assert.equal(c.teamflash_duration, 0);
});

test('deriveUtilityCounts: a teammate finishing the blinded enemy inside the window counts as a flash assist', () => {
  // duration 1.1s (at the half-blind threshold) @ 64 tick -> blind expires at tick+70;
  // window is 3s (192 ticks) after that -> tick+262.
  const throws = [throwRow({ tick: 100, flasher: 1, blinded: 3, duration: 1.1 })];
  const deaths = [death({ tick: 362, victim: 3, attacker: 2 })]; // 2 is 1's SHIRTS teammate, at the exact window edge
  const out = deriveUtilityCounts(throws, deaths, FACTIONS);
  assert.equal(lookupUtilityCounts('1:1', out).flash_assists, 1);
});

test('deriveUtilityCounts: a kill one tick past the assist window does not count', () => {
  const throws = [throwRow({ tick: 100, flasher: 1, blinded: 3, duration: 1.1 })];
  const deaths = [death({ tick: 363, victim: 3, attacker: 2 })];
  const out = deriveUtilityCounts(throws, deaths, FACTIONS);
  assert.equal(lookupUtilityCounts('1:1', out).flash_assists, 0);
});

test('deriveUtilityCounts: the flasher finishing their own flashed enemy is a kill, not an assist — but does count as flashes_leading_to_kill', () => {
  const throws = [throwRow({ tick: 100, flasher: 1, blinded: 3, duration: 1.1 })];
  const deaths = [death({ tick: 150, victim: 3, attacker: 1 })]; // 1 gets the kill themself, while 3 is still blinded
  const out = deriveUtilityCounts(throws, deaths, FACTIONS);
  const c = lookupUtilityCounts('1:1', out);
  assert.equal(c.flash_assists, 0);
  assert.equal(c.flashes_leading_to_kill, 1);
});

test('deriveUtilityCounts: flashes_leading_to_kill still counts a kill shortly after the blind expires (widened window)', () => {
  // duration 1.1s @ 64 tick -> blind expires at tick+70 (170); window extends half the duration
  // (0.55s = 35 ticks) past that, to tick 205. This kill lands one tick after expiry, well inside.
  const throws = [throwRow({ tick: 100, flasher: 1, blinded: 3, duration: 1.1 })];
  const deaths = [death({ tick: 171, victim: 3, attacker: 1 })];
  const out = deriveUtilityCounts(throws, deaths, FACTIONS);
  assert.equal(lookupUtilityCounts('1:1', out).flashes_leading_to_kill, 1);
});

test('deriveUtilityCounts: flashes_leading_to_kill does not count a kill past the widened window', () => {
  // duration 1.1s @ 64 tick -> blind expires at tick+70 (170); widened window ends at tick 205
  // (170 + round(0.55 * 64) = 170 + 35). This kill lands one tick past that.
  const throws = [throwRow({ tick: 100, flasher: 1, blinded: 3, duration: 1.1 })];
  const deaths = [death({ tick: 206, victim: 3, attacker: 1 })];
  const out = deriveUtilityCounts(throws, deaths, FACTIONS);
  assert.equal(lookupUtilityCounts('1:1', out).flashes_leading_to_kill, 0);
});

test('deriveUtilityCounts: a half-blind kill does not count as flashes_leading_to_kill', () => {
  const throws = [throwRow({ tick: 100, flasher: 1, blinded: 3, duration: 1 })]; // below 1.1s threshold
  const deaths = [death({ tick: 150, victim: 3, attacker: 1 })];
  const out = deriveUtilityCounts(throws, deaths, FACTIONS);
  assert.equal(lookupUtilityCounts('1:1', out).flashes_leading_to_kill, 0);
});

test('deriveUtilityCounts: a blind at or above the 1.1s half-blind threshold counts as enemies_flashed', () => {
  const out = deriveUtilityCounts([throwRow({ tick: 100, flasher: 1, blinded: 3, duration: 1.1 })], [], FACTIONS);
  assert.equal(lookupUtilityCounts('1:1', out).enemies_flashed, 1);
});

test('deriveUtilityCounts: a blind below the 1.1s half-blind threshold does not count as enemies_flashed', () => {
  const out = deriveUtilityCounts([throwRow({ tick: 100, flasher: 1, blinded: 3, duration: 1.09 })], [], FACTIONS);
  assert.equal(lookupUtilityCounts('1:1', out).enemies_flashed, 0);
});

test('deriveUtilityCounts: a half-blind still accumulates raw blind_duration_dealt', () => {
  const out = deriveUtilityCounts([throwRow({ tick: 100, flasher: 1, blinded: 3, duration: 0.5 })], [], FACTIONS);
  const c = lookupUtilityCounts('1:1', out);
  assert.equal(c.blind_duration_dealt, 0.5);
  assert.equal(c.enemies_flashed, 0);
});

test('deriveUtilityCounts: a half-blind kill does not count as a flash assist even inside the window', () => {
  const throws = [throwRow({ tick: 100, flasher: 1, blinded: 3, duration: 1 })]; // below 1.1s threshold
  const deaths = [death({ tick: 150, victim: 3, attacker: 2 })]; // 2 is 1's SHIRTS teammate
  const out = deriveUtilityCounts(throws, deaths, FACTIONS);
  assert.equal(lookupUtilityCounts('1:1', out).flash_assists, 0);
});

test('deriveUtilityCounts: one flash blinding two enemies counts as one effective flash, using the longest duration', () => {
  // Same (flasher, round, tick) = one detonation; 3 gets the longer blind, 4 the shorter.
  const throws = [
    throwRow({ tick: 100, flasher: 1, blinded: 3, duration: 2.5 }),
    throwRow({ tick: 100, flasher: 1, blinded: 4, duration: 1.5 }),
  ];
  const out = deriveUtilityCounts(throws, [], FACTIONS);
  const c = lookupUtilityCounts('1:1', out);
  assert.equal(c.effective_flashes, 1);
  assert.equal(c.blind_duration_max_sum, 2.5);
});

test('deriveUtilityCounts: two separate flashes sum their own max durations', () => {
  const throws = [
    throwRow({ tick: 100, flasher: 1, blinded: 3, duration: 1.2 }),
    throwRow({ tick: 500, flasher: 1, blinded: 4, duration: 3 }),
  ];
  const out = deriveUtilityCounts(throws, [], FACTIONS);
  const c = lookupUtilityCounts('1:1', out);
  assert.equal(c.effective_flashes, 2);
  assert.equal(c.blind_duration_max_sum, 4.2);
});

test('deriveUtilityCounts: a flash with only a sub-threshold blind is not an effective flash', () => {
  const out = deriveUtilityCounts([throwRow({ tick: 100, flasher: 1, blinded: 3, duration: 0.8 })], [], FACTIONS);
  const c = lookupUtilityCounts('1:1', out);
  assert.equal(c.effective_flashes, 0);
  assert.equal(c.blind_duration_max_sum, 0);
});

test('deriveUtilityCounts: counts are scoped per match — the same player_id in two matches does not share totals', () => {
  const factions = new Map<string, Faction>([...FACTIONS, ['2:1', 'SHIRTS'], ['2:3', 'SKINS']]);
  const throws = [
    throwRow({ tick: 100, flasher: 1, blinded: 3, duration: 1.5 }),
    { match_id: 2, round_number: 1, tick: 100, flasher_player_id: 1, blinded_player_id: 3, blind_duration: 2.0 },
  ];
  const out = deriveUtilityCounts(throws, [], factions);
  assert.equal(lookupUtilityCounts('1:1', out).enemies_flashed, 1);
  assert.equal(lookupUtilityCounts('1:1', out).blind_duration_dealt, 1.5);
  assert.equal(lookupUtilityCounts('2:1', out).enemies_flashed, 1);
  assert.equal(lookupUtilityCounts('2:1', out).blind_duration_dealt, 2.0);
});

test('deriveUtilityCounts: a throw with an unresolvable flasher or blinded faction is skipped', () => {
  const out = deriveUtilityCounts([throwRow({ tick: 100, flasher: 1, blinded: 99, duration: 1.5 })], [], FACTIONS);
  assert.equal(lookupUtilityCounts('1:1', out).blind_duration_dealt, 0);
});

test('lookupUtilityCounts: an unknown key returns all-zero counts', () => {
  const out = deriveUtilityCounts([], [], FACTIONS);
  const c = lookupUtilityCounts('1:999', out);
  assert.deepEqual(c, {
    flash_assists: 0, teamflash_duration: 0, enemies_flashed: 0, flashes_leading_to_kill: 0,
    effective_flashes: 0, blind_duration_dealt: 0, blind_duration_max_sum: 0,
  });
});

report();
