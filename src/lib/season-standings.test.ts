/**
 * Tests for season-standings.ts. Run: npx vitest run src/lib/season-standings.test.ts
 */

import assert from 'node:assert/strict';
import { rankMovementForWeek, rankPlayersThroughWeek, type StandingsWeek } from './season-standings';
import { test } from './test-support/miniTest';

type S = { player_id: number; is_win: boolean; damage: number; rounds_won: number; rounds_played: number };
const st = (player_id: number, is_win: boolean, rounds_won: number, rounds_played: number, damage: number): S => ({
  player_id, is_win, rounds_won, rounds_played, damage,
});

/** A 2v2 match: shirts [1,2] vs skins [3,4]. */
function game(score: '13-9' | '9-13', damages: [number, number, number, number]): StandingsWeek['matches'][number] {
  const shirtsWin = score === '13-9';
  return {
    final_score: score,
    shirts_stats: [1, 2].map((id, i) => st(id, shirtsWin, shirtsWin ? 13 : 9, 22, damages[i])),
    skins_stats: [3, 4].map((id, i) => st(id, !shirtsWin, shirtsWin ? 9 : 13, 22, damages[i + 2])),
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
