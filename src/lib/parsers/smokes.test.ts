/**
 * Unit tests for collectSmokes — CT-side smokes interfering with pushes (#173 phase 3.5),
 * matching Leetify's "[CT] Smokes That Stopped a Push". detonate/expire events are paired by
 * (round, entityid) — confirmed against a real DGLS demo that both events share the same
 * entityid and detonation position.
 *
 * Run:  npx tsx src/lib/parsers/smokes.test.ts
 */

import assert from 'node:assert/strict';
import { collectSmokes, type SmokeEventRow, type PlayerPositionRow } from './smokes';
import { makeContext } from './matchContextFixture';

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

function detonate(opts: { round: number; tick: number; entityid: number; user: string | null; x: number; y: number }): SmokeEventRow {
  return { tick: opts.tick, total_rounds_played: opts.round - 1, entityid: opts.entityid, user_steamid: opts.user, x: opts.x, y: opts.y };
}

function expire(opts: { round: number; tick: number; entityid: number; user: string | null; x: number; y: number }): SmokeEventRow {
  return detonate(opts);
}

function pos(opts: { tick: number; steamid: string; x: number; y: number }): PlayerPositionRow {
  return { tick: opts.tick, steamid: opts.steamid, x: opts.x, y: opts.y };
}

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const ids = Object.keys(sides);
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const, endTick: 10000 }];
const tickRate = 64;
// SAMPLE_INTERVAL_SECONDS = 2 -> 128 ticks at 64 tick rate.

test('collectSmokes: an enemy within the block radius during the smoke\'s life counts as blocking', () => {
  const detonates = [detonate({ round: 1, tick: 1000, entityid: 50, user: 'a', x: 0, y: 0 })];
  const expires = [expire({ round: 1, tick: 1256, entityid: 50, user: 'a', x: 0, y: 0 })];
  const positions = [pos({ tick: 1128, steamid: 'c', x: 100, y: 0 })]; // enemy T, well within 800 units
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectSmokes(detonates, expires, positions, ctx, ids);
  assert.equal(out.get('a')?.smokes_blocking_push, 1);
});

test('collectSmokes: every CT smoke thrown counts toward ct_smokes_thrown, blocking or not', () => {
  const detonates = [detonate({ round: 1, tick: 1000, entityid: 50, user: 'a', x: 0, y: 0 })];
  const expires = [expire({ round: 1, tick: 1256, entityid: 50, user: 'a', x: 0, y: 0 })];
  const positions = [pos({ tick: 1128, steamid: 'c', x: 5000, y: 0 })]; // enemy far away, doesn't block
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectSmokes(detonates, expires, positions, ctx, ids);
  assert.equal(out.get('a')?.ct_smokes_thrown, 1);
  assert.equal(out.get('a')?.smokes_blocking_push ?? 0, 0);
});

test('collectSmokes: a T-side smoke is not counted toward smokes_blocking_push or ct_smokes_thrown', () => {
  const detonates = [detonate({ round: 1, tick: 1000, entityid: 50, user: 'c', x: 0, y: 0 })]; // c is T
  const expires = [expire({ round: 1, tick: 1256, entityid: 50, user: 'c', x: 0, y: 0 })];
  const positions = [pos({ tick: 1128, steamid: 'a', x: 100, y: 0 })]; // enemy CT, well within 800 units
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectSmokes(detonates, expires, positions, ctx, ids);
  assert.equal(out.get('c')?.smokes_blocking_push ?? 0, 0);
  assert.equal(out.get('c')?.ct_smokes_thrown ?? 0, 0);
});

test('collectSmokes: no enemy within radius does not count', () => {
  const detonates = [detonate({ round: 1, tick: 1000, entityid: 50, user: 'a', x: 0, y: 0 })];
  const expires = [expire({ round: 1, tick: 1256, entityid: 50, user: 'a', x: 0, y: 0 })];
  const positions = [pos({ tick: 1128, steamid: 'c', x: 5000, y: 0 })]; // enemy far away
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectSmokes(detonates, expires, positions, ctx, ids);
  assert.equal(out.get('a')?.smokes_blocking_push ?? 0, 0);
});

test('collectSmokes: a teammate nearby (not an enemy) does not count', () => {
  const detonates = [detonate({ round: 1, tick: 1000, entityid: 50, user: 'a', x: 0, y: 0 })];
  const expires = [expire({ round: 1, tick: 1256, entityid: 50, user: 'a', x: 0, y: 0 })];
  const positions = [pos({ tick: 1128, steamid: 'b', x: 50, y: 0 })]; // b is a's CT teammate
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectSmokes(detonates, expires, positions, ctx, ids);
  assert.equal(out.get('a')?.smokes_blocking_push ?? 0, 0);
});

test('collectSmokes: a smoke with no matching expire falls back to the round end tick', () => {
  const detonates = [detonate({ round: 1, tick: 1000, entityid: 50, user: 'a', x: 0, y: 0 })];
  const positions = [pos({ tick: 10000, steamid: 'c', x: 50, y: 0 })]; // near round end, no expire event
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectSmokes(detonates, [], positions, ctx, ids);
  assert.equal(out.get('a')?.smokes_blocking_push, 1);
});

test('collectSmokes: detonate/expire pairing does not cross entity ids', () => {
  const detonates = [detonate({ round: 1, tick: 1000, entityid: 50, user: 'a', x: 0, y: 0 })];
  // A different entity's expire event, arriving right after — must not be treated as entity 50's end.
  const expires = [expire({ round: 1, tick: 1010, entityid: 99, user: 'a', x: 9999, y: 9999 })];
  const positions = [pos({ tick: 1128, steamid: 'c', x: 50, y: 0 })]; // within radius, but only valid if entity 50's life extends this far
  const ctx = makeContext({ rounds, sides, tickRate });
  const out = collectSmokes(detonates, expires, positions, ctx, ids);
  assert.equal(out.get('a')?.smokes_blocking_push, 1); // falls back to round end, so tick 1128 is still in-life
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
