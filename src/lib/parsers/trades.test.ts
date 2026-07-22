/**
 * Unit tests for collectTrades — trade-kill/traded-death opportunity/attempt/success counts
 * (#173 phase 1.1). The success condition must stay in lockstep with kast.ts's "Traded" KAST
 * qualifier (same trade window, same permissive same-side check), so a few cases here mirror
 * kast.test.ts's trade cases directly.
 *
 * Run:  npx tsx src/lib/parsers/trades.test.ts
 */

import assert from 'node:assert/strict';
import { collectTrades } from './trades';
import { makeContext, death, hurt } from './matchContextFixture';
import type { PlayerPositionRow } from './smokes';

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

function pos(opts: { tick: number; steamid: string; x: number; y: number }): PlayerPositionRow {
  return opts;
}

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const ids = Object.keys(sides);
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];
const tickRate = 64;
const WINDOW = 5 * tickRate; // TRADE_WINDOW_SECONDS

// Every non-distance-gate test below places the victim and teammate on top of each other (both
// at the death tick) so the 180-unit distance gate never interferes with what they're
// actually testing.
function nearbyPositions(tick: number, victim: string, teammate: string): PlayerPositionRow[] {
  return [
    pos({ tick, steamid: victim, x: 0, y: 0 }),
    pos({ tick, steamid: teammate, x: 100, y: 0 }),
  ];
}

test('collectTrades: a live, nearby teammate gets a trade-kill opportunity and the victim gets a traded-death opportunity', () => {
  // c (T) kills a (CT); b is a's CT teammate and still alive, standing nearby.
  const deaths = [death({ round: 1, tick: 100, victim: 'a', attacker: 'c' })];
  const positions = nearbyPositions(100, 'a', 'b');
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, [], positions, ctx, ids);
  assert.equal(out.get('b')?.trade_kill_opportunities, 1);
  assert.equal(out.get('a')?.traded_death_opportunities, 1);
});

test('collectTrades: no opportunity when the only teammate already died first', () => {
  const deaths = [
    death({ round: 1, tick: 50, victim: 'b', attacker: 'd' }),
    death({ round: 1, tick: 100, victim: 'a', attacker: 'c' }),
  ];
  const positions = nearbyPositions(100, 'a', 'b');
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, [], positions, ctx, ids);
  assert.equal(out.get('b')?.trade_kill_opportunities ?? 0, 0);
  assert.equal(out.get('a')?.traded_death_opportunities ?? 0, 0);
});

test('collectTrades: no opportunity/attempt/success when there is no killer (world death)', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'a', attacker: null })];
  const positions = nearbyPositions(100, 'a', 'b');
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, [], positions, ctx, ids);
  assert.equal(out.get('b')?.trade_kill_opportunities ?? 0, 0);
  assert.equal(out.get('a')?.traded_death_opportunities ?? 0, 0);
});

test('collectTrades: damaging the killer within the window counts as an attempt', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'a', attacker: 'c' })];
  const hurts = [hurt({ round: 1, tick: 150, attacker: 'b', victim: 'c' })];
  const positions = nearbyPositions(100, 'a', 'b');
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, hurts, positions, ctx, ids);
  assert.equal(out.get('b')?.trade_kill_attempts, 1);
  assert.equal(out.get('a')?.traded_death_attempts, 1);
});

test('collectTrades: no damage on the killer within the window means no attempt', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'a', attacker: 'c' })];
  const positions = nearbyPositions(100, 'a', 'b');
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, [], positions, ctx, ids);
  assert.equal(out.get('b')?.trade_kill_attempts ?? 0, 0);
  assert.equal(out.get('a')?.traded_death_attempts ?? 0, 0);
});

test('collectTrades: killing the killer within the window counts as a success (mirrors KAST Traded)', () => {
  const deaths = [
    death({ round: 1, tick: 100, victim: 'a', attacker: 'c' }),
    death({ round: 1, tick: 100 + WINDOW, victim: 'c', attacker: 'b' }), // exact window edge
  ];
  const positions = nearbyPositions(100, 'a', 'b');
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, [], positions, ctx, ids);
  assert.equal(out.get('b')?.trade_kill_successes, 1);
  assert.equal(out.get('a')?.traded_death_successes, 1);
});

test('collectTrades: killing the killer one tick past the window does not count as a success', () => {
  const deaths = [
    death({ round: 1, tick: 100, victim: 'a', attacker: 'c' }),
    death({ round: 1, tick: 101 + WINDOW, victim: 'c', attacker: 'b' }),
  ];
  const positions = nearbyPositions(100, 'a', 'b');
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, [], positions, ctx, ids);
  assert.equal(out.get('b')?.trade_kill_successes ?? 0, 0);
  assert.equal(out.get('a')?.traded_death_successes ?? 0, 0);
});

test('collectTrades: a teammate beyond 180 units gets no opportunity, even if alive and on the same side', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'a', attacker: 'c' })];
  const positions = [
    pos({ tick: 100, steamid: 'a', x: 0, y: 0 }),
    pos({ tick: 100, steamid: 'b', x: 5000, y: 0 }), // far across the map
  ];
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, [], positions, ctx, ids);
  assert.equal(out.get('b')?.trade_kill_opportunities ?? 0, 0);
  assert.equal(out.get('a')?.traded_death_opportunities ?? 0, 0);
});

test('collectTrades: a teammate exactly at 180 units still counts', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'a', attacker: 'c' })];
  const positions = [
    pos({ tick: 100, steamid: 'a', x: 0, y: 0 }),
    pos({ tick: 100, steamid: 'b', x: 180, y: 0 }),
  ];
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, [], positions, ctx, ids);
  assert.equal(out.get('b')?.trade_kill_opportunities, 1);
  assert.equal(out.get('a')?.traded_death_opportunities, 1);
});

test('collectTrades: missing position data for the victim fails closed (no opportunity)', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'a', attacker: 'c' })];
  const positions = [pos({ tick: 100, steamid: 'b', x: 0, y: 0 })]; // no row for 'a'
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, [], positions, ctx, ids);
  assert.equal(out.get('b')?.trade_kill_opportunities ?? 0, 0);
  assert.equal(out.get('a')?.traded_death_opportunities ?? 0, 0);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
