/**
 * Unit tests for classifyRoundEconomy — round-economy tier classification (#279), from each
 * player's own CCSPlayerPawn.m_unFreezetimeEndEquipmentValue at a round's freeze-time-end.
 *
 * Run:  npx vitest run src/lib/parsers/economy.test.ts
 */

import assert from 'node:assert/strict';
import {
  classifyEconomy, classifyRoundEconomy, type RoundFreezeEndRow, type PlayerEquipmentRow,
} from './economy';
import { makeContext } from './matchContextFixture';
import { test, report } from '../test-support/miniTest';

function freeze(opts: { round: number; tick: number }): RoundFreezeEndRow {
  return { tick: opts.tick, total_rounds_played: opts.round - 1 };
}

function equip(opts: { tick: number; steamid: string; value: number }): PlayerEquipmentRow {
  return { tick: opts.tick, steamid: opts.steamid, equipmentValue: opts.value };
}

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const ids = Object.keys(sides);
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];

test('classifyEconomy: below $2000 is eco', () => {
  assert.equal(classifyEconomy(850), 'eco');
  assert.equal(classifyEconomy(1999), 'eco');
});

test('classifyEconomy: $2000-3499 is force_buy', () => {
  assert.equal(classifyEconomy(2000), 'force_buy');
  assert.equal(classifyEconomy(3499), 'force_buy');
});

test('classifyEconomy: $3500+ is full_buy', () => {
  assert.equal(classifyEconomy(3500), 'full_buy');
  assert.equal(classifyEconomy(4750), 'full_buy');
});

test('classifyRoundEconomy: classifies each player independently for a round', () => {
  const freezes = [freeze({ round: 1, tick: 100 })];
  const rows = [
    equip({ tick: 100, steamid: 'a', value: 800 }),
    equip({ tick: 100, steamid: 'c', value: 4200 }),
  ];
  const ctx = makeContext({ rounds, sides });
  const out = classifyRoundEconomy(freezes, rows, ctx, ids);
  assert.equal(out.get('a')?.get(1), 'eco');
  assert.equal(out.get('c')?.get(1), 'full_buy');
});

test('classifyRoundEconomy: a round with no matching equipment row is left unclassified', () => {
  const freezes = [freeze({ round: 1, tick: 100 })];
  const ctx = makeContext({ rounds, sides });
  const out = classifyRoundEconomy(freezes, [], ctx, ids);
  assert.equal(out.get('a')?.has(1), false);
});

report();
