/**
 * Unit tests for utility.ts: collectUtility (flashes_thrown, the one utility stat that stays
 * live-collected since it needs weapon_fire events no fact table carries) and
 * collectMatchUtilityThrows (the match_utility_throws fact-table row builder). Every other flash
 * stat (blind_duration_dealt, teamflash_duration, flash_assists, enemies_flashed,
 * flashes_leading_to_kill, effective_flashes, blind_duration_max_sum) is derived at query time from
 * match_utility_throws instead — see queries-utility.test.ts for those scenarios.
 *
 * Run:  npx vitest run src/lib/parsers/utility.test.ts
 */

import assert from 'node:assert/strict';
import { collectUtility, collectMatchUtilityThrows, type PlayerBlindRow, type WeaponFireRow } from './utility';
import { makeContext } from './matchContextFixture';
import { test, report } from '../test-support/miniTest';

function blind(opts: { round: number; tick: number; attacker: string | null; user: string | null; duration: number }): PlayerBlindRow {
  return { tick: opts.tick, total_rounds_played: opts.round - 1, attacker_steamid: opts.attacker, user_steamid: opts.user, blind_duration: opts.duration };
}

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const ids = Object.keys(sides);
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];
const tickRate = 64;

test('collectUtility: flashes_thrown counts only weapon_flashbang fire events', () => {
  const fires: WeaponFireRow[] = [
    { tick: 100, total_rounds_played: 0, user_steamid: 'a', weapon: 'weapon_flashbang' },
    { tick: 150, total_rounds_played: 0, user_steamid: 'a', weapon: 'weapon_hegrenade' },
    { tick: 200, total_rounds_played: 0, user_steamid: 'a', weapon: 'weapon_flashbang' },
  ];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectUtility(fires, ctx, ids);
  assert.equal(out.get('a')?.flashes_thrown, 2);
});

test('collectUtility: a fire event outside any live round is dropped', () => {
  const fires: WeaponFireRow[] = [
    { tick: 100, total_rounds_played: 98, user_steamid: 'a', weapon: 'weapon_flashbang' },
  ];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectUtility(fires, ctx, ids);
  assert.equal(out.get('a')?.flashes_thrown ?? 0, 0);
});

test('collectMatchUtilityThrows: one row per blind event, with resolved flasher/blinded/duration/tick', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 1.5 })];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectMatchUtilityThrows(blinds, ctx, ids);
  assert.deepEqual(out, [
    { round_number: 1, flasher_steamid: 'a', blinded_steamid: 'c', blind_duration: 1.5, tick: 100 },
  ]);
});

test('collectMatchUtilityThrows: a sub-threshold or teammate flash is still a row — no judgment calls baked in', () => {
  const blinds = [
    blind({ round: 1, tick: 100, attacker: 'a', user: 'c', duration: 0.3 }), // sub-threshold
    blind({ round: 1, tick: 200, attacker: 'a', user: 'b', duration: 2 }), // teammate (a, b both CT)
  ];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectMatchUtilityThrows(blinds, ctx, ids);
  assert.equal(out.length, 2);
});

test('collectMatchUtilityThrows: a self-flash is kept, not filtered', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: 'a', user: 'a', duration: 1 })];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectMatchUtilityThrows(blinds, ctx, ids);
  assert.equal(out.length, 1);
  assert.equal(out[0].flasher_steamid, 'a');
  assert.equal(out[0].blinded_steamid, 'a');
});

test('collectMatchUtilityThrows: a blind outside any live round is dropped', () => {
  const blinds = [blind({ round: 99, tick: 50, attacker: 'a', user: 'c', duration: 1 })];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectMatchUtilityThrows(blinds, ctx, ids);
  assert.equal(out.length, 0);
});

test('collectMatchUtilityThrows: a blind with no attacker (world/unknown) is dropped', () => {
  const blinds = [blind({ round: 1, tick: 100, attacker: null, user: 'c', duration: 1 })];
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectMatchUtilityThrows(blinds, ctx, ids);
  assert.equal(out.length, 0);
});

report();
