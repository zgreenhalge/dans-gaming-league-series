/**
 * Regression tests for `aggregatePlayerStats`/`aggregatePlayerStatsByMap` (player-stats.ts) — the
 * shared per-match-row aggregation behind PlayerView's career/season summary tile, its
 * season-history table rows, and per-map buckets.
 *
 * Assertions are plain `node:assert`, no matcher library (mirrors util.test.ts). Run:
 *   npx vitest run src/lib/player-stats.test.ts
 */

import assert from 'node:assert/strict';
import { aggregatePlayerStats, aggregatePlayerStatsByMap, type PlayerAggregateRow } from './player-stats';
import { test, report } from './test-support/miniTest';

function approx(actual: number, expected: number, msg?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, msg ?? `expected ~${expected}, got ${actual}`);
}

function playerRow(opts: Partial<PlayerAggregateRow>): PlayerAggregateRow {
  return {
    final_score: '13-9',
    rounds_played: 22,
    rounds_won: 13,
    is_win: true,
    kills: 20,
    assists: 5,
    deaths: 15,
    damage: 2000,
    map: 'Palais',
    ...opts,
  };
}

test('aggregatePlayerStats: sums raw totals and derives WR/KD/RWR/ADR via deriveRates', () => {
  const rows = [
    playerRow({ is_win: true, kills: 20, deaths: 10, damage: 2000, rounds_played: 20, rounds_won: 13 }),
    playerRow({ is_win: false, kills: 10, deaths: 20, damage: 1500, rounds_played: 20, rounds_won: 7 }),
  ];
  const a = aggregatePlayerStats(rows);
  assert.equal(a.matches, 2);
  assert.equal(a.wins, 1);
  assert.equal(a.losses, 1);
  assert.equal(a.wr, 50);
  assert.equal(a.kills, 30);
  assert.equal(a.deaths, 30);
  approx(a.kd, 1);
  approx(a.rwr, 50); // (13 + 7) / 40
  approx(a.adr, 87.5); // 3500 / 40
});

test('aggregatePlayerStats: excludes unplayed rows ("0-0" pre-staged and rounds_played === 0)', () => {
  const rows = [
    playerRow({ final_score: '0-0' }),
    playerRow({ final_score: null }),
    playerRow({ final_score: '13-9', rounds_played: 0 }),
  ];
  const a = aggregatePlayerStats(rows);
  assert.equal(a.matches, 0);
  assert.equal(a.wr, 0);
});

test('aggregatePlayerStats: splits kills/deaths into in-wins vs in-losses buckets', () => {
  const rows = [
    playerRow({ is_win: true, kills: 20, deaths: 5 }),
    playerRow({ is_win: false, kills: 8, deaths: 18 }),
  ];
  const a = aggregatePlayerStats(rows);
  assert.equal(a.kills_in_wins, 20);
  assert.equal(a.deaths_in_wins, 5);
  assert.equal(a.kills_in_losses, 8);
  assert.equal(a.deaths_in_losses, 18);
});

test('aggregatePlayerStatsByMap: buckets by map (groupByMap normalization) and sorts by WR% -> RWR% -> ADR desc', () => {
  const rows = [
    playerRow({ map: 'de dust 2', is_win: true, rounds_won: 13, rounds_played: 22, damage: 2200 }),
    playerRow({ map: 'de-dust-2', is_win: false, rounds_won: 9, rounds_played: 22, damage: 1800 }),
    playerRow({ map: 'Vertigo', is_win: true, rounds_won: 13, rounds_played: 20, damage: 2000 }),
  ];
  const out = aggregatePlayerStatsByMap(rows);
  assert.equal(out.length, 2); // "de dust 2" and "de-dust-2" merge into one bucket
  assert.equal(out[0].map, 'Vertigo'); // 100% WR beats Dust 2's 50%
  const dust2 = out.find((m) => m.map === 'de dust 2');
  assert.ok(dust2);
  assert.equal(dust2!.wins, 1);
  assert.equal(dust2!.losses, 1);
});

test('aggregatePlayerStatsByMap: a map with zero played matches in scope is dropped, not shown as an empty row', () => {
  const out = aggregatePlayerStatsByMap([playerRow({ map: 'Palais', final_score: '0-0' })]);
  assert.equal(out.length, 0);
});

report();
