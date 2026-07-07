/**
 * Unit tests for collectTrades — trade-kill/traded-death opportunity/attempt/success counts
 * (#173 phase 1.1). The success condition must stay in lockstep with kast.ts's "Traded" KAST
 * qualifier (same trade window, same permissive same-side check), so a few cases here mirror
 * kast.test.ts's trade cases directly.
 *
 * Run:  npx tsx src/lib/parsers/trades.test.ts
 */

import assert from 'node:assert/strict';
import { collectTrades, type PlayerHurtRow } from './trades';
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

function hurt(opts: { round: number; tick: number; attacker: string | null; victim: string | null }): PlayerHurtRow {
  return { tick: opts.tick, total_rounds_played: opts.round - 1, attacker_steamid: opts.attacker, user_steamid: opts.victim };
}

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const ids = Object.keys(sides);
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];
const tickRate = 64;
const WINDOW = 5 * tickRate; // TRADE_WINDOW_SECONDS

test('collectTrades: a live teammate gets a trade-kill opportunity and the victim gets a traded-death opportunity', () => {
  // c (T) kills a (CT); b is a's CT teammate and still alive.
  const deaths = [death({ round: 1, tick: 100, victim: 'a', attacker: 'c' })];
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, [], ctx, ids);
  assert.equal(out.get('b')?.trade_kill_opportunities, 1);
  assert.equal(out.get('a')?.traded_death_opportunities, 1);
});

test('collectTrades: no opportunity when the only teammate already died first', () => {
  const deaths = [
    death({ round: 1, tick: 50, victim: 'b', attacker: 'd' }),
    death({ round: 1, tick: 100, victim: 'a', attacker: 'c' }),
  ];
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, [], ctx, ids);
  assert.equal(out.get('b')?.trade_kill_opportunities ?? 0, 0);
  assert.equal(out.get('a')?.traded_death_opportunities ?? 0, 0);
});

test('collectTrades: no opportunity/attempt/success when there is no killer (world death)', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'a', attacker: null })];
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, [], ctx, ids);
  assert.equal(out.get('b')?.trade_kill_opportunities ?? 0, 0);
  assert.equal(out.get('a')?.traded_death_opportunities ?? 0, 0);
});

test('collectTrades: damaging the killer within the window counts as an attempt', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'a', attacker: 'c' })];
  const hurts = [hurt({ round: 1, tick: 150, attacker: 'b', victim: 'c' })];
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, hurts, ctx, ids);
  assert.equal(out.get('b')?.trade_kill_attempts, 1);
  assert.equal(out.get('a')?.traded_death_attempts, 1);
});

test('collectTrades: no damage on the killer within the window means no attempt', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'a', attacker: 'c' })];
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, [], ctx, ids);
  assert.equal(out.get('b')?.trade_kill_attempts ?? 0, 0);
  assert.equal(out.get('a')?.traded_death_attempts ?? 0, 0);
});

test('collectTrades: killing the killer within the window counts as a success (mirrors KAST Traded)', () => {
  const deaths = [
    death({ round: 1, tick: 100, victim: 'a', attacker: 'c' }),
    death({ round: 1, tick: 100 + WINDOW, victim: 'c', attacker: 'b' }), // exact window edge
  ];
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, [], ctx, ids);
  assert.equal(out.get('b')?.trade_kill_successes, 1);
  assert.equal(out.get('a')?.traded_death_successes, 1);
});

test('collectTrades: killing the killer one tick past the window does not count as a success', () => {
  const deaths = [
    death({ round: 1, tick: 100, victim: 'a', attacker: 'c' }),
    death({ round: 1, tick: 101 + WINDOW, victim: 'c', attacker: 'b' }),
  ];
  const ctx = makeContext({ rounds, sides, deaths, tickRate });
  const out = collectTrades(deaths, [], ctx, ids);
  assert.equal(out.get('b')?.trade_kill_successes ?? 0, 0);
  assert.equal(out.get('a')?.traded_death_successes ?? 0, 0);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
