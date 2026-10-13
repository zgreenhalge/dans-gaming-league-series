/**
 * Tests for season-standings.ts. Run: npx vitest run src/lib/season-standings.test.ts
 */

import assert from 'node:assert/strict';
import { rankMovementForWeek, rankPlayersThroughWeek, type StandingsWeek } from './season-standings';
import type { ScorecardStat } from './group-scorecard';
import { canonicalSort, deriveAdr, deriveRwr } from './util';
import { test } from './test-support/miniTest';

/** A stat as `player_match_stats` carries it: raw `damage` and rounds, plus a rounded per-match `adr`
 *  (which the standings must not be built from). */
const st = (
  player_id: number,
  is_win: boolean,
  rounds_won: number,
  rounds_played: number,
  damage: number,
  faction: 'SHIRTS' | 'SKINS' = 'SHIRTS',
): ScorecardStat => ({
  player_id, faction, is_win, rounds_won, rounds_played, damage, adr: Math.round(damage / Math.max(rounds_played, 1)),
});

/** A 2v2 match: shirts [1,2] vs skins [3,4]. */
function game(score: '13-9' | '9-13', damages: [number, number, number, number]): StandingsWeek['matches'][number] {
  const shirtsWin = score === '13-9';
  return {
    final_score: score,
    shirts_stats: [1, 2].map((id, i) => st(id, shirtsWin, shirtsWin ? 13 : 9, 22, damages[i], 'SHIRTS')),
    skins_stats: [3, 4].map((id, i) => st(id, !shirtsWin, shirtsWin ? 9 : 13, 22, damages[i + 2], 'SKINS')),
  };
}

test('rankPlayersThroughWeek: wins first, then RWR%, then ADR', () => {
  const weeks: StandingsWeek[] = [
    { week_number: 1, matches: [game('13-9', [2000, 1500, 1400, 1300])] },
  ];
  // 1 and 2 both 1-0 with the same RWR; 1's higher damage separates them. Same for 3 / 4 at 0-1.
  assert.deepEqual([...rankPlayersThroughWeek(weeks, 1)], [[1, 1], [2, 2], [3, 3], [4, 4]]);
});

test('rankPlayersThroughWeek: only counts weeks up to throughWeek and ignores unplayed matches', () => {
  const weeks: StandingsWeek[] = [
    { week_number: 1, matches: [game('13-9', [2000, 1500, 1400, 1300])] },
    { week_number: 2, matches: [game('9-13', [1000, 1000, 2000, 2000]), { final_score: '0-0', shirts_stats: [st(1, false, 0, 0, 0)], skins_stats: [] }] },
  ];
  assert.equal(rankPlayersThroughWeek(weeks, 0).size, 0);
  const after2 = rankPlayersThroughWeek(weeks, 2);
  // Week 2 flipped it: 3 and 4 are now 1-1 with better RWR than 1 and 2... all 1-1, split on RWR.
  assert.equal(after2.size, 4);
  assert.deepEqual(rankPlayersThroughWeek(weeks, 1).get(1), 1);
});

test('rankMovementForWeek: before is null for a first appearance and otherwise the prior rank', () => {
  const weeks: StandingsWeek[] = [
    { week_number: 1, matches: [game('13-9', [2000, 1500, 1400, 1300])] },
    { week_number: 2, matches: [game('9-13', [1000, 1000, 2000, 2000])] },
  ];
  const w1 = rankMovementForWeek(weeks, 1);
  assert.deepEqual(w1.get(1), { before: null, after: 1 });
  const w2 = rankMovementForWeek(weeks, 2);
  assert.equal(w2.get(1)!.before, 1);
  assert.ok(w2.get(3)!.after < w2.get(3)!.before!, 'a player who won week 2 moved up');
});

test('rankPlayersThroughWeek: orders on exact damage / rounds played, not the rounded per-match ADR', () => {
  // Two players, one win each, same rounds. Both round to the same stored `adr` (100), but raw
  // damage separates them: 2199/22 = 99.95 vs 2201/22 = 100.05.
  const match = {
    final_score: '13-9',
    shirts_stats: [st(1, true, 13, 22, 2201), st(2, true, 13, 22, 2199)],
    skins_stats: [],
  };
  assert.equal(match.shirts_stats[0].adr, match.shirts_stats[1].adr);
  const ranks = rankPlayersThroughWeek([{ week_number: 1, matches: [match] }], 1);
  assert.equal(ranks.get(1), 1);
  assert.equal(ranks.get(2), 2);
});

test('rankPlayersThroughWeek: through the final week it matches the season leaderboard order', () => {
  // A deterministic season (6 weeks, 8 players, 2v2 games) ranked independently from raw totals the
  // way the `player_season_leaderboard` view does: wins, then rounds won / rounds played, then
  // damage / rounds played.
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const weeks: StandingsWeek[] = [];
  const totals = new Map<number, { wins: number; won: number; played: number; damage: number }>();
  for (let w = 1; w <= 6; w++) {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8].sort(() => rand() - 0.5);
    const matches = [];
    for (let g = 0; g < 2; g++) {
      const [a, b, c, d] = ids.slice(g * 4, g * 4 + 4);
      const shirtsWin = rand() < 0.5;
      const loser = 5 + Math.floor(rand() * 8);
      const shirtsRounds = shirtsWin ? 13 : loser;
      const skinsRounds = shirtsWin ? loser : 13;
      const played = shirtsRounds + skinsRounds;
      const stats = [
        ...[a, b].map((id) => st(id, shirtsWin, shirtsRounds, played, Math.round(40 * played + rand() * 60 * played), 'SHIRTS')),
        ...[c, d].map((id) => st(id, !shirtsWin, skinsRounds, played, Math.round(40 * played + rand() * 60 * played), 'SKINS')),
      ];
      for (const s of stats) {
        const t = totals.get(s.player_id) ?? { wins: 0, won: 0, played: 0, damage: 0 };
        t.wins += s.is_win ? 1 : 0;
        t.won += s.rounds_won!;
        t.played += s.rounds_played!;
        t.damage += s.damage!;
        totals.set(s.player_id, t);
      }
      matches.push({ final_score: `${shirtsRounds}-${skinsRounds}`, shirts_stats: stats.slice(0, 2), skins_stats: stats.slice(2) });
    }
    weeks.push({ week_number: w, matches });
  }
  const leaderboard = [...totals]
    .map(([player_id, t]) => ({
      player_id,
      matches_won: t.wins,
      rwr_percentage: deriveRwr({ total_rounds_played: t.played, total_rounds_won: t.won }),
      overall_adr: deriveAdr({ total_rounds_played: t.played, total_damage: t.damage }),
    }))
    .sort((x, y) => canonicalSort(x, y) || x.player_id - y.player_id)
    .map((r) => r.player_id);
  const standings = [...rankPlayersThroughWeek(weeks, 6)].sort((x, y) => x[1] - y[1]).map(([id]) => id);
  assert.deepEqual(standings, leaderboard);
});
