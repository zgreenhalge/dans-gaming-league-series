/**
 * Unit tests for collectKast — the K/A/S/T-qualification round counter that drives the KAST% sab
 * field. Each of the four qualification paths (kill / assist / survive / traded) is a separate
 * branch that silently under/over-counts if it regresses, and the trade window boundary is an easy
 * off-by-one, so each gets a dedicated case.
 *
 * Run:  npx tsx src/lib/parsers/kast.test.ts
 */

import assert from 'node:assert/strict';
import { collectKast } from './kast';
import { computeTradeOpportunities } from './trades';
import { makeContext, death } from './matchContextFixture';
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

const SIDES = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const IDS = Object.keys(SIDES);
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];

// Trade-path tests below place the dying player, the killer, and the trader on top of each
// other (all at the trade-window death's tick) so computeTradeOpportunities()'s distance gate
// never interferes with what they're actually testing — the boundary test at the bottom overrides
// this.
function tradePositions(tick: number, victim: string, killer: string, trader: string): PlayerPositionRow[] {
  return [
    pos({ tick, steamid: victim, x: 0, y: 0 }),
    pos({ tick, steamid: killer, x: 0, y: 0 }),
    pos({ tick, steamid: trader, x: 0, y: 0 }),
  ];
}

test('collectKast: a non-teamkill kill qualifies the attacker', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'c', attacker: 'a' })];
  const ctx = makeContext({ rounds, sides: SIDES, deaths });
  const out = collectKast(deaths, ctx, IDS, computeTradeOpportunities(deaths, [], ctx, IDS));
  assert.equal(out.get('a')?.kast_rounds, 1);
});

test('collectKast: a teamkill does NOT qualify the attacker via the kill path', () => {
  // a teamkills b, then a dies untraded — isolates the kill branch (survive/trade both fail for a).
  const deaths = [
    death({ round: 1, tick: 100, victim: 'b', attacker: 'a' }),
    death({ round: 1, tick: 200, victim: 'a', attacker: 'c' }),
  ];
  const ctx = makeContext({ rounds, sides: SIDES, deaths });
  const out = collectKast(deaths, ctx, IDS, computeTradeOpportunities(deaths, [], ctx, IDS));
  assert.equal(out.get('a')?.kast_rounds ?? 0, 0);
});

test('collectKast: an assist (no kill) qualifies via the assist path', () => {
  // a assists on b's kill of d, then a dies untraded — isolates the assist branch.
  const deaths = [
    death({ round: 1, tick: 100, victim: 'd', attacker: 'b', assister: 'a' }),
    death({ round: 1, tick: 200, victim: 'a', attacker: 'c' }),
  ];
  const ctx = makeContext({ rounds, sides: SIDES, deaths });
  const out = collectKast(deaths, ctx, IDS, computeTradeOpportunities(deaths, [], ctx, IDS));
  assert.equal(out.get('a')?.kast_rounds, 1);
});

test('collectKast: a player with no death and no kill/assist qualifies via survive', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'c', attacker: 'a' })];
  const ctx = makeContext({ rounds, sides: SIDES, deaths });
  const out = collectKast(deaths, ctx, IDS, computeTradeOpportunities(deaths, [], ctx, IDS));
  assert.equal(out.get('b')?.kast_rounds, 1); // b didn't die, didn't kill/assist -> survived
});

test('collectKast: died with no kill/assist/trade does NOT qualify', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'd', attacker: 'a' })]; // d dies, nobody trades
  const ctx = makeContext({ rounds, sides: SIDES, deaths });
  const out = collectKast(deaths, ctx, IDS, computeTradeOpportunities(deaths, [], ctx, IDS));
  assert.equal(out.get('d')?.kast_rounds ?? 0, 0);
});

test('collectKast: traded — teammate with a real trade opportunity kills the killer within the trade window', () => {
  const tradeWindow = Math.round(5 * 64); // 320 ticks at 64 tickrate
  const deaths = [
    death({ round: 1, tick: 100, victim: 'd', attacker: 'a' }), // a kills d
    death({ round: 1, tick: 100 + tradeWindow, victim: 'a', attacker: 'c' }), // c (d's teammate) trades a, exactly at the window edge
  ];
  const positions = tradePositions(100, 'd', 'a', 'c');
  const ctx = makeContext({ rounds, sides: SIDES, deaths, tickRate: 64 });
  const out = collectKast(deaths, ctx, IDS, computeTradeOpportunities(deaths, positions, ctx, IDS));
  assert.equal(out.get('d')?.kast_rounds, 1); // trade is inclusive of the exact window edge
});

test('collectKast: one tick past the trade window does NOT count as traded', () => {
  const tradeWindow = Math.round(5 * 64);
  const deaths = [
    death({ round: 1, tick: 100, victim: 'd', attacker: 'a' }),
    death({ round: 1, tick: 100 + tradeWindow + 1, victim: 'a', attacker: 'c' }),
  ];
  const positions = tradePositions(100, 'd', 'a', 'c');
  const ctx = makeContext({ rounds, sides: SIDES, deaths, tickRate: 64 });
  const out = collectKast(deaths, ctx, IDS, computeTradeOpportunities(deaths, positions, ctx, IDS));
  assert.equal(out.get('d')?.kast_rounds ?? 0, 0);
});

test('collectKast: an avenger who is not the victim\'s teammate does not count as a trade', () => {
  const deaths = [
    death({ round: 1, tick: 100, victim: 'd', attacker: 'a' }), // a (CT) kills d (T)
    death({ round: 1, tick: 150, victim: 'a', attacker: 'b' }), // b (CT) kills a back — b is a's teammate, not d's
  ];
  const positions = tradePositions(100, 'd', 'a', 'b');
  const ctx = makeContext({ rounds, sides: SIDES, deaths });
  const out = collectKast(deaths, ctx, IDS, computeTradeOpportunities(deaths, positions, ctx, IDS));
  assert.equal(out.get('d')?.kast_rounds ?? 0, 0);
});

test('collectKast: rounds outside liveRounds are ignored entirely', () => {
  const deaths = [death({ round: 2, tick: 100, victim: 'd', attacker: 'a' })]; // round 2 not live
  const ctx = makeContext({ rounds, sides: SIDES, deaths });
  const out = collectKast(deaths, ctx, IDS, computeTradeOpportunities(deaths, [], ctx, IDS));
  // Round 1 is live with no deaths at all -> everyone survives round 1.
  assert.equal(out.get('a')?.kast_rounds, 1);
  assert.equal(out.get('d')?.kast_rounds, 1);
});

test('collectKast: a trader beyond the trade-opportunity distance does NOT count as traded, even within the window', () => {
  const tradeWindow = Math.round(5 * 64);
  const deaths = [
    death({ round: 1, tick: 100, victim: 'd', attacker: 'a' }), // a kills d
    death({ round: 1, tick: 100 + tradeWindow, victim: 'a', attacker: 'c' }), // c trades a, in-window but far away
  ];
  const positions = [
    pos({ tick: 100, steamid: 'd', x: 0, y: 0 }),
    pos({ tick: 100, steamid: 'a', x: 0, y: 0 }),
    pos({ tick: 100, steamid: 'c', x: 5000, y: 0 }), // c was nowhere near the fight
  ];
  const ctx = makeContext({ rounds, sides: SIDES, deaths, tickRate: 64 });
  const out = collectKast(deaths, ctx, IDS, computeTradeOpportunities(deaths, positions, ctx, IDS));
  assert.equal(out.get('d')?.kast_rounds ?? 0, 0);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
