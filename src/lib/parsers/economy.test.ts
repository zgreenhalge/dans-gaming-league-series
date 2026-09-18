/**
 * Unit tests for classifyRoundEconomy — round-economy tier classification (#279, #519), from each
 * player's own CCSPlayerPawn.m_unFreezetimeEndEquipmentValue and
 * CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iAccount at a round's
 * freeze-time-end, plus their side that round.
 *
 * Run:  npx vitest run src/lib/parsers/economy.test.ts
 */

import assert from 'node:assert/strict';
import {
  classifyEconomy, classifyRoundEconomy, collectMatchRoundEconomy,
  type RoundFreezeEndRow, type PlayerEquipmentRow,
} from './economy';
import { makeContext } from './matchContextFixture';
import { test, report } from '../test-support/miniTest';

function freeze(opts: { round: number; tick: number }): RoundFreezeEndRow {
  return { tick: opts.tick, total_rounds_played: opts.round - 1 };
}

function equip(opts: { tick: number; steamid: string; value: number; cash?: number }): PlayerEquipmentRow {
  return { tick: opts.tick, steamid: opts.steamid, equipmentValue: opts.value, remainingCash: opts.cash ?? 0 };
}

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const ids = Object.keys(sides);
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];

test('classifyEconomy: a complete kit is full_buy no matter what is left over', () => {
  assert.equal(classifyEconomy(3800, 0, 'T'), 'full_buy');
  assert.equal(classifyEconomy(3800, 9000, 'T'), 'full_buy');
  assert.equal(classifyEconomy(3799, 500, 'T'), 'force'); // just under the floor, bank spent down
  assert.equal(classifyEconomy(4400, 0, 'CT'), 'full_buy');
  assert.equal(classifyEconomy(4399, 9000, 'CT'), 'eco'); // just under the CT floor, bank healthy
});

test('classifyEconomy: short of a full buy, under $2000 remaining is force regardless of equipment', () => {
  assert.equal(classifyEconomy(0, 0, 'T'), 'force');
  assert.equal(classifyEconomy(3000, 1999, 'T'), 'force');
});

test('classifyEconomy: $2000+ remaining splits save (under $1000 equip) from eco (at least $1000)', () => {
  assert.equal(classifyEconomy(0, 2000, 'T'), 'save');
  assert.equal(classifyEconomy(999, 5000, 'T'), 'save');
  assert.equal(classifyEconomy(1000, 2000, 'T'), 'eco');
  assert.equal(classifyEconomy(3000, 2000, 'T'), 'eco');
});

test('classifyRoundEconomy: classifies each player independently for a round, by their own side', () => {
  const freezes = [freeze({ round: 1, tick: 100 })];
  const rows = [
    equip({ tick: 100, steamid: 'a', value: 800, cash: 2500 }),
    equip({ tick: 100, steamid: 'c', value: 4200 }),
  ];
  const ctx = makeContext({ rounds, sides });
  const out = classifyRoundEconomy(freezes, rows, ctx, ids);
  assert.equal(out.get('a')?.get(1), 'save');
  assert.equal(out.get('c')?.get(1), 'full_buy');
});

test('classifyRoundEconomy: a round with no matching equipment row is left unclassified', () => {
  const freezes = [freeze({ round: 1, tick: 100 })];
  const ctx = makeContext({ rounds, sides });
  const out = classifyRoundEconomy(freezes, [], ctx, ids);
  assert.equal(out.get('a')?.has(1), false);
});

test('classifyRoundEconomy: a round with no resolvable side is left unclassified', () => {
  const freezes = [freeze({ round: 1, tick: 100 })];
  const rows = [equip({ tick: 100, steamid: 'a', value: 800 })];
  const ctx = makeContext({ rounds, sides, hasSides: false });
  const out = classifyRoundEconomy(freezes, rows, ctx, ids);
  assert.equal(out.get('a')?.has(1), false);
});

test('collectMatchRoundEconomy: one row per (round, player), with resolved economy_type/equipment_value', () => {
  const freezes = [freeze({ round: 1, tick: 100 })];
  const rows = [
    equip({ tick: 100, steamid: 'a', value: 800, cash: 2500 }),
    equip({ tick: 100, steamid: 'c', value: 4200 }),
  ];
  const ctx = makeContext({ rounds, sides });
  const out = collectMatchRoundEconomy(freezes, rows, ctx, ids);
  assert.equal(out.length, 2);
  const a = out.find((r) => r.player_steamid === 'a');
  assert.deepEqual(a, { round_number: 1, player_steamid: 'a', economy_type: 'save', equipment_value: 800 });
  const c = out.find((r) => r.player_steamid === 'c');
  assert.equal(c?.economy_type, 'full_buy');
});

test('collectMatchRoundEconomy: a round with no matching equipment row produces no row for that player', () => {
  const freezes = [freeze({ round: 1, tick: 100 })];
  const ctx = makeContext({ rounds, sides });
  const out = collectMatchRoundEconomy(freezes, [], ctx, ids);
  assert.equal(out.length, 0);
});

report();
