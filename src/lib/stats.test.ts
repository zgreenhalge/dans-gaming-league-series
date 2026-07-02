/**
 * Unit tests for computeAdvancedStats. Every field is gated behind a zero-games/zero-rounds/
 * zero-kills guard that falls back to NaN (rendered as "—" by the UI) instead of throwing or
 * showing Infinity — that's the behavior worth locking down, since a new player row with 0 matches
 * played is a real, common case (not an edge case).
 *
 * Run:  npx tsx src/lib/stats.test.ts
 */

import assert from 'node:assert/strict';
import { computeAdvancedStats } from './stats';
import type { LeaderboardRowWithId } from './types';

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

function row(overrides: Partial<LeaderboardRowWithId>): LeaderboardRowWithId {
  return {
    season_id: 1,
    player_id: 1,
    player_name: 'Test',
    matches_played: 0,
    matches_won: 0,
    matches_lost: 0,
    win_rate_percentage: 0,
    total_kills: 0,
    total_assists: 0,
    total_deaths: 0,
    kd_ratio: 0,
    total_damage: 0,
    total_rounds_played: 0,
    total_rounds_won: 0,
    rwr_percentage: 0,
    overall_adr: 0,
    kills_in_wins: 0,
    deaths_in_wins: 0,
    kills_in_losses: 0,
    deaths_in_losses: 0,
    ...overrides,
  };
}

test('computeAdvancedStats: a zero-games player gets NaN across the board, not Infinity/throw', () => {
  const s = computeAdvancedStats(row({}));
  assert.ok(Number.isNaN(s.killDiff));
  assert.ok(Number.isNaN(s.kPerRound));
  assert.ok(Number.isNaN(s.kPerWin));
  assert.ok(Number.isNaN(s.kPerLoss));
  assert.ok(Number.isNaN(s.rdPerGame));
  assert.ok(Number.isNaN(s.dmgPerKill));
});

test('computeAdvancedStats: normal totals compute the expected per-round and per-game rates', () => {
  const s = computeAdvancedStats(
    row({
      total_kills: 100,
      total_deaths: 60,
      total_assists: 20,
      total_damage: 9000,
      total_rounds_played: 100,
      total_rounds_won: 55,
      matches_won: 6,
      matches_lost: 4,
      matches_played: 10,
      kills_in_wins: 70,
      deaths_in_wins: 30,
      kills_in_losses: 30,
      deaths_in_losses: 30,
    }),
  );
  assert.equal(s.killDiff, 40);
  assert.equal(s.dmgPerKill, 90);
  assert.equal(s.kPerRound, 1);
  assert.equal(s.roundsLost, 45);
  assert.equal(s.roundDiff, 10); // 55 won - 45 lost
  assert.equal(s.kPerWin, 70 / 6);
  assert.equal(s.kPerLoss, 30 / 4);
  assert.equal(s.kdPerGame, 4); // (100-60)/10
});

test('computeAdvancedStats: matches played but zero wins does not NaN the loss-side rates', () => {
  const s = computeAdvancedStats(
    row({
      matches_played: 3,
      matches_lost: 3,
      total_kills: 30,
      total_deaths: 45,
      kills_in_losses: 30,
      deaths_in_losses: 45,
      total_rounds_played: 30,
      total_rounds_won: 10,
    }),
  );
  assert.ok(Number.isNaN(s.kPerWin)); // matches_won is 0 -> still NaN
  assert.equal(s.kPerLoss, 10);
  assert.equal(s.roundDiff, -10); // 10 won - 20 lost
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
