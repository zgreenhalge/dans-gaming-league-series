/**
 * Tests for the shared group-scorecard rollup (group-scorecard.ts): its numbers, its ordering rules,
 * and that those orderings are the ones the rest of the site ranks by — `canonicalSort` for
 * `'wins'`, and `canonicalGauntletRankMap` for `'win_rate'`. Run:
 *   npx vitest run src/lib/group-scorecard.test.ts
 */

import assert from 'node:assert/strict';
import { aggregatePlayerRecords, deriveGroupScorecard, type ScorecardMatch, type ScorecardStat } from './group-scorecard';
import { canonicalGauntletRankMap } from './gauntlet-ranking';
import { canonicalSort } from './util';
import { test } from './test-support/miniTest';

function stat(player_id: number, faction: 'SHIRTS' | 'SKINS', is_win: boolean, adr = 80): ScorecardStat {
  return { player_id, player_name: `P${player_id}`, faction, is_win, adr, kills: 10, deaths: 8 };
}

function match(score: string, shirts: [number, number], skins: [number, number], adr = 80): ScorecardMatch {
  const [s, k] = score.split('-').map(Number);
  return {
    final_score: score,
    shirts_stats: shirts.map((id) => stat(id, 'SHIRTS', s > k, adr)),
    skins_stats: skins.map((id) => stat(id, 'SKINS', k > s, adr)),
  };
}

test('aggregatePlayerRecords: sums record, rounds and round-weighted ADR; skips unplayed matches', () => {
  const records = aggregatePlayerRecords([
    match('13-9', [1, 2], [3, 4], 100),
    match('7-13', [1, 3], [2, 4], 60),
    { final_score: '0-0', shirts_stats: [stat(1, 'SHIRTS', false)], skins_stats: [stat(2, 'SKINS', false)] },
    { final_score: null, shirts_stats: [stat(1, 'SHIRTS', false)], skins_stats: [stat(2, 'SKINS', false)] },
  ]);
  const p1 = records.get(1)!;
  assert.equal(p1.matches_played, 2);
  assert.equal(p1.wins, 1);
  assert.equal(p1.losses, 1);
  assert.equal(p1.win_rate, 50);
  // 13 rounds won of 22, then 7 of 20.
  assert.equal(p1.rounds_won, 13 + 7);
  assert.equal(p1.rounds_played, 22 + 20);
  assert.equal(p1.rwr_percentage, (20 / 42) * 100);
  assert.equal(p1.adr, (100 * 22 + 60 * 20) / 42);
  assert.equal(p1.kills, 20);
  assert.equal(p1.deaths, 16);
  assert.equal(p1.kd_ratio, 1.25);
  assert.equal(records.get(1)!.player_name, 'P1');
});

test('aggregatePlayerRecords: a player with no deaths has a K/D equal to their kills', () => {
  const records = aggregatePlayerRecords([
    { final_score: '13-0', shirts_stats: [{ player_id: 1, faction: 'SHIRTS', is_win: true, adr: 90, kills: 7, deaths: 0 }], skins_stats: [] },
  ]);
  assert.equal(records.get(1)!.kd_ratio, 7);
});

test('aggregatePlayerRecords: falls back to #id when a stat has no name', () => {
  const records = aggregatePlayerRecords([
    { final_score: '13-0', shirts_stats: [{ player_id: 9, faction: 'SHIRTS', is_win: true, adr: 90 }], skins_stats: [] },
  ]);
  assert.equal(records.get(9)!.player_name, '#9');
});

test("deriveGroupScorecard('wins'): orders exactly like canonicalSort over the same rows", () => {
  const matches = [
    match('13-9', [1, 2], [3, 4], 90),
    match('13-11', [1, 3], [2, 4], 70),
    match('9-13', [1, 4], [2, 3], 85),
    match('13-5', [2, 4], [1, 3], 75),
  ];
  const rows = deriveGroupScorecard(matches, 'wins');
  const expected = [...aggregatePlayerRecords(matches).values()]
    .map((r) => ({ id: r.player_id, matches_won: r.wins, rwr_percentage: r.rwr_percentage, overall_adr: r.adr }))
    .sort(canonicalSort)
    .map((r) => r.id);
  assert.deepEqual(rows.map((r) => r.player_id), expected);
});

test("deriveGroupScorecard('wins'): a doubleheader's extra win outranks a better win rate", () => {
  // Player 1 goes 2-1; player 2 goes 1-0. Wins decide, so 1 leads despite the lower win rate.
  const rows = deriveGroupScorecard(
    [match('13-9', [1, 3], [4, 5]), match('13-9', [1, 3], [4, 5]), match('9-13', [1, 3], [4, 5]), match('13-1', [2, 6], [7, 8])],
    'wins',
  );
  assert.equal(rows[0].player_id, 1);
  assert.ok(rows.find((r) => r.player_id === 2)!.win_rate > rows[0].win_rate);
});

test("deriveGroupScorecard('win_rate'): win rate decides before raw wins", () => {
  const rows = deriveGroupScorecard(
    [match('13-9', [1, 3], [4, 5]), match('13-9', [1, 3], [4, 5]), match('9-13', [1, 3], [4, 5]), match('13-1', [2, 6], [7, 8])],
    'win_rate',
  );
  assert.equal(rows[0].player_id, 2);
});

// ── 'win_rate' is the canonical gauntlet ordering ────────────────────────────────────────────────

// Small deterministic PRNG so a failure reproduces.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** A pod's two games: partners reshuffled, random scores and per-match ADRs. */
function randomPod(players: [number, number, number, number], rand: () => number): ScorecardMatch[] {
  const [a, b, c, d] = players;
  const game = (shirts: [number, number], skins: [number, number]): ScorecardMatch => {
    const shirtsWin = rand() < 0.5;
    const loserRounds = Math.floor(rand() * 12);
    const score = shirtsWin ? `13-${loserRounds}` : `${loserRounds}-13`;
    const out = match(score, shirts, skins);
    for (const s of [...out.shirts_stats, ...out.skins_stats]) s.adr = 40 + Math.floor(rand() * 80);
    return out;
  };
  return [game([a, b], [c, d]), game([a, c], [b, d])];
}

test("deriveGroupScorecard('win_rate') reproduces canonicalGauntletRankMap's final-round places on random gauntlets", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rand = rng(seed);
    const ids = (n: number, from: number) => Array.from({ length: n }, (_, i) => from + i);
    // 12 -> 8 -> 4: three pods, two pods, then a final.
    const r1 = ids(12, 1);
    const r2 = r1.slice(0, 8);
    const r3 = r2.slice(0, 4);
    const pods = (players: number[]) =>
      Array.from({ length: players.length / 4 }, (_, i) => players.slice(i * 4, i * 4 + 4) as [number, number, number, number]);
    const rounds = [r1, r2, r3].map((players, i) => ({
      round_number: i + 1,
      matches: pods(players).flatMap((p) => randomPod(p, rand)),
    }));

    const rankMap = canonicalGauntletRankMap(rounds, 3);
    const finalScorecard = deriveGroupScorecard(rounds[2].matches, 'win_rate');
    finalScorecard.forEach((row, i) => {
      assert.equal(rankMap.get(row.player_id), i + 1, `seed ${seed}: player ${row.player_id} final place`);
    });
  }
});

test('aggregatePlayerRecords: a stat with raw totals contributes its own damage and rounds, not adr x match rounds', () => {
  const exact = (id: number, faction: 'SHIRTS' | 'SKINS', is_win: boolean, over: Partial<ScorecardStat>): ScorecardStat => ({
    ...stat(id, faction, is_win, 100),
    ...over,
  });
  // 13-9 (22 rounds). Stored adr 100 would imply 2200 damage; the raw total says 2199 over 22 rounds.
  const records = aggregatePlayerRecords([
    {
      final_score: '13-9',
      shirts_stats: [exact(1, 'SHIRTS', true, { damage: 2199, rounds_won: 13, rounds_played: 22 })],
      skins_stats: [],
    },
  ]);
  const p1 = records.get(1)!;
  assert.equal(p1.total_damage, 2199);
  assert.equal(p1.adr, 2199 / 22);
});

test('aggregatePlayerRecords: a player who played fewer rounds than the match is weighted by their own rounds', () => {
  // Joined late: 15 of the match's 22 rounds, 13-9 final, their side won 8 of those.
  const records = aggregatePlayerRecords([
    {
      final_score: '13-9',
      shirts_stats: [{ ...stat(1, 'SHIRTS', true, 100), damage: 900, rounds_won: 8, rounds_played: 15 }],
      skins_stats: [],
    },
  ]);
  const p1 = records.get(1)!;
  assert.equal(p1.rounds_played, 15);
  assert.equal(p1.rounds_won, 8);
  assert.equal(p1.adr, 60);
  assert.equal(p1.rwr_percentage, (8 / 15) * 100);
});

test('aggregatePlayerRecords: a stat without parsed rounds (rounds_played 0) falls back to the score and adr', () => {
  const records = aggregatePlayerRecords([
    {
      final_score: '13-9',
      shirts_stats: [{ ...stat(1, 'SHIRTS', true, 80), damage: 0, rounds_won: 0, rounds_played: 0 }],
      skins_stats: [],
    },
  ]);
  const p1 = records.get(1)!;
  assert.equal(p1.rounds_played, 22);
  assert.equal(p1.rounds_won, 13);
  assert.equal(p1.adr, 80);
});

test('aggregatePlayerRecords: exact and fallback stats add up across matches for one player', () => {
  const records = aggregatePlayerRecords([
    { final_score: '13-9', shirts_stats: [{ ...stat(1, 'SHIRTS', true, 100), damage: 2000, rounds_won: 13, rounds_played: 22 }], skins_stats: [] },
    { final_score: '13-7', shirts_stats: [stat(1, 'SHIRTS', true, 90)], skins_stats: [] },
  ]);
  const p1 = records.get(1)!;
  assert.equal(p1.total_damage, 2000 + 90 * 20);
  assert.equal(p1.rounds_played, 22 + 20);
});
