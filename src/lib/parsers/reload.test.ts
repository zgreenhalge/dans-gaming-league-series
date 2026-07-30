/**
 * Unit tests for collectRoundsDropped — rounds dropped on reload (#212). weapon_reload is a
 * discrete game event, so each fixture supplies a reload event plus a single tick-state row at
 * that same tick (Weapon.m_iClip1/Weapon.m_bInReload), matching how demoOrchestrator.ts samples
 * the netprop once per event rather than periodically.
 *
 * Run:  npx tsx src/lib/parsers/reload.test.ts
 */

import assert from 'node:assert/strict';
import { collectRoundsDropped, type WeaponReloadRow, type PlayerReloadStateRow } from './reload';
import { makeContext } from './matchContextFixture';
import { test, report } from '../test-support/miniTest';

function reload(opts: { round: number; tick: number; user: string | null }): WeaponReloadRow {
  return { tick: opts.tick, total_rounds_played: opts.round - 1, user_steamid: opts.user };
}

function state(opts: { tick: number; steamid: string; inReload: boolean; clip1: number }): PlayerReloadStateRow {
  return opts;
}

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const ids = Object.keys(sides);
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];

test('collectRoundsDropped: a reload with rounds still in the clip counts both the total and the reload', () => {
  const reloads = [reload({ round: 1, tick: 100, user: 'a' })];
  const rows = [state({ tick: 100, steamid: 'a', inReload: true, clip1: 6 })];
  const ctx = makeContext({ rounds, sides });
  const out = collectRoundsDropped(reloads, rows, ctx, ids);
  assert.equal(out.get('a')?.rounds_dropped_on_reload_total, 6);
  assert.equal(out.get('a')?.reloads_total, 1);
});

test('collectRoundsDropped: an empty-clip reload counts the reload but drops nothing', () => {
  const reloads = [reload({ round: 1, tick: 100, user: 'a' })];
  const rows = [state({ tick: 100, steamid: 'a', inReload: true, clip1: 0 })];
  const ctx = makeContext({ rounds, sides });
  const out = collectRoundsDropped(reloads, rows, ctx, ids);
  assert.equal(out.get('a')?.rounds_dropped_on_reload_total ?? 0, 0);
  assert.equal(out.get('a')?.reloads_total, 1);
});

test('collectRoundsDropped: sums across multiple reloads in the match', () => {
  const reloads = [
    reload({ round: 1, tick: 100, user: 'a' }),
    reload({ round: 1, tick: 200, user: 'a' }),
  ];
  const rows = [
    state({ tick: 100, steamid: 'a', inReload: true, clip1: 4 }),
    state({ tick: 200, steamid: 'a', inReload: true, clip1: 2 }),
  ];
  const ctx = makeContext({ rounds, sides });
  const out = collectRoundsDropped(reloads, rows, ctx, ids);
  assert.equal(out.get('a')?.rounds_dropped_on_reload_total, 6);
  assert.equal(out.get('a')?.reloads_total, 2);
});

test('collectRoundsDropped: a missing tick-state row for a reload is skipped, not a crash', () => {
  const reloads = [reload({ round: 1, tick: 100, user: 'a' })];
  const ctx = makeContext({ rounds, sides });
  const out = collectRoundsDropped(reloads, [], ctx, ids);
  assert.equal(out.get('a')?.rounds_dropped_on_reload_total ?? 0, 0);
  assert.equal(out.get('a')?.reloads_total ?? 0, 0);
});

test('collectRoundsDropped: a tick row that reads inReload=false is not trusted for a dropped count', () => {
  const reloads = [reload({ round: 1, tick: 100, user: 'a' })];
  const rows = [state({ tick: 100, steamid: 'a', inReload: false, clip1: 6 })];
  const ctx = makeContext({ rounds, sides });
  const out = collectRoundsDropped(reloads, rows, ctx, ids);
  assert.equal(out.get('a')?.rounds_dropped_on_reload_total ?? 0, 0);
  assert.equal(out.get('a')?.reloads_total ?? 0, 0);
});

report();
