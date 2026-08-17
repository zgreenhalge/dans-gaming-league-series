/**
 * Regression tests for `canonicalGauntletRankMap` (gauntlet-ranking.ts) — the official finish-order
 * ranking for a completed gauntlet, rendered by `GauntletStandings`'s podium and passed as
 * `canonicalRanking` to `LeaderboardTable` on gauntlet season pages.
 *
 * Assertions are plain `node:assert`, no matcher library (mirrors util.test.ts). Run:
 *   npx vitest run src/lib/gauntlet-ranking.test.ts
 */

import assert from 'node:assert/strict';
import { canonicalGauntletRankMap } from './gauntlet-ranking';
import { test, report } from './test-support/miniTest';

type P = { player_id: number; faction: 'SHIRTS' | 'SKINS'; is_win: boolean; adr: number };
function gp(player_id: number, faction: 'SHIRTS' | 'SKINS', is_win: boolean, adr = 80): P {
  return { player_id, faction, is_win, adr };
}

test('canonicalGauntletRankMap: no rounds returns an empty map', () => {
  assert.equal(canonicalGauntletRankMap([]).size, 0);
});

test('canonicalGauntletRankMap: an incomplete final round returns an empty map', () => {
  const rounds = [
    {
      round_number: 1,
      matches: [
        {
          final_score: '0-0', // unplayed
          shirts_stats: [gp(1, 'SHIRTS', false)],
          skins_stats: [gp(2, 'SKINS', false)],
        },
      ],
    },
  ];
  assert.equal(canonicalGauntletRankMap(rounds).size, 0);
});

test('canonicalGauntletRankMap: final-round wins rank above ties, RWR% breaks ties, and earlier eliminations rank lower', () => {
  const rounds = [
    // Round 1 (non-final): p5 loses to p8 and is never seen again -> eliminated round 1.
    {
      round_number: 1,
      matches: [
        {
          final_score: '13-10',
          shirts_stats: [gp(5, 'SHIRTS', false, 50)],
          skins_stats: [gp(8, 'SKINS', true, 55)],
        },
      ],
    },
    // Round 2 (non-final): p8 loses to p9; neither reaches the final -> both eliminated round 2.
    {
      round_number: 2,
      matches: [
        {
          final_score: '13-11',
          shirts_stats: [gp(8, 'SHIRTS', false, 60)],
          skins_stats: [gp(9, 'SKINS', true, 65)],
        },
      ],
    },
    // Round 3 (final): two independent 1v1s. p1 and p3 each go 1-0 (tie broken by RWR%);
    // p2 and p4 each go 0-1 (tie broken by RWR%).
    {
      round_number: 3,
      matches: [
        {
          final_score: '13-9', // 22 rounds total
          shirts_stats: [gp(1, 'SHIRTS', true, 90)],
          skins_stats: [gp(2, 'SKINS', false, 70)],
        },
        {
          final_score: '13-11', // 24 rounds total
          shirts_stats: [gp(3, 'SHIRTS', true, 85)],
          skins_stats: [gp(4, 'SKINS', false, 65)],
        },
      ],
    },
  ];

  const rank = canonicalGauntletRankMap(rounds);

  // p1 RWR 13/22 ≈ .591 beats p3's 13/24 ≈ .542 -> p1 above p3 despite an equal 1-0 record.
  assert.equal(rank.get(1), 1);
  assert.equal(rank.get(3), 2);
  // p4 RWR 11/24 ≈ .458 beats p2's 9/22 ≈ .409 -> p4 above p2 despite an equal 0-1 record.
  assert.equal(rank.get(4), 3);
  assert.equal(rank.get(2), 4);
  // Eliminated in round 2 ranks above eliminated in round 1, regardless of that round's record.
  assert.ok((rank.get(9) as number) < (rank.get(5) as number));
  assert.ok((rank.get(8) as number) < (rank.get(5) as number));
  // Within round-2 eliminations, the round-2 winner (p9) ranks above the round-2 loser (p8).
  assert.ok((rank.get(9) as number) < (rank.get(8) as number));
});

test('canonicalGauntletRankMap: within a round, win rate outranks a higher raw win count from more matches played', () => {
  const rounds = [
    // Round 1 (non-final, a pod): p20 goes 2-1 (67% win rate) across three matches; p21 goes
    // 1-0 (100% win rate) in a single match. p20 has more raw wins but the lower win rate.
    {
      round_number: 1,
      matches: [
        {
          final_score: '13-9',
          shirts_stats: [gp(20, 'SHIRTS', true, 80)],
          skins_stats: [gp(30, 'SKINS', false, 80)],
        },
        {
          final_score: '13-9',
          shirts_stats: [gp(20, 'SHIRTS', true, 80)],
          skins_stats: [gp(31, 'SKINS', false, 80)],
        },
        {
          final_score: '9-13',
          shirts_stats: [gp(20, 'SHIRTS', false, 80)],
          skins_stats: [gp(32, 'SKINS', true, 80)],
        },
        {
          final_score: '9-13',
          shirts_stats: [gp(33, 'SHIRTS', false, 80)],
          skins_stats: [gp(21, 'SKINS', true, 80)],
        },
      ],
    },
    // Round 2 (final): a single 1v1 to complete the gauntlet.
    {
      round_number: 2,
      matches: [
        {
          final_score: '13-9',
          shirts_stats: [gp(1, 'SHIRTS', true, 80)],
          skins_stats: [gp(2, 'SKINS', false, 80)],
        },
      ],
    },
  ];

  const rank = canonicalGauntletRankMap(rounds);

  // p21 (1-0, 100% win rate) outranks p20 (2-1, 67% win rate) despite p20's higher raw win count.
  assert.ok((rank.get(21) as number) < (rank.get(20) as number));
});

report();
