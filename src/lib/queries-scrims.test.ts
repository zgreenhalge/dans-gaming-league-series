/**
 * Scrim night reads: a night's leaderboard (scored matches only, ranked Wins → RWR% → ADR), the night
 * view for a current and a past night, and the past-nights list.
 *
 * Run:  npx vitest run src/lib/queries-scrims.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestAdminClient } from './supabase-admin';
import { createFakeSupabaseClient, type FakeDb, type Row } from './test-support/fakeSupabase';
import { test, report } from './test-support/miniTest';
import { buildScrimNightLeaderboard, getPastScrimNights, getScrimMatchDetail, getScrimNight, type ScrimMatch, type ScrimMatchPlayer } from './queries';
import { scrimNightSlots, type ScrimSchedule } from './scrim-schedule';

const SCHEDULE: ScrimSchedule = { weekday: 4, startTime: '20:00', timezone: 'America/New_York', enabled: true };
const NOW = new Date('2026-11-02T12:00:00Z'); // Monday; the next night is Thu 2026-11-05
const [UPCOMING] = scrimNightSlots(SCHEDULE, [], NOW, 1).map((s) => s.date);
const PAST = '2026-10-29';
const PAST_EMPTY = '2026-10-22';

function line(player_id: number, faction: 'SHIRTS' | 'SKINS', won: boolean, kills: number, damage: number, roundsWon: number): ScrimMatchPlayer {
  return { player_id, faction, kills, assists: 0, deaths: 10, damage, adr: Math.round(damage / 20), rounds_played: 20, rounds_won: roundsWon, is_win: won };
}

function scrimMatch(id: number, final_score: string | null, players: ScrimMatchPlayer[]): ScrimMatch {
  return {
    id, match_number: id, map: 'Foroglio', side_choice: 'knife', final_score, server_state: null, players,
    shirts: players.filter((p) => p.faction === 'SHIRTS').map((p) => p.player_id),
    skins: players.filter((p) => p.faction === 'SKINS').map((p) => p.player_id),
  };
}

const PLAYERS = new Map([1, 2, 3, 4, 5].map((id) => [id, { name: `P${id}`, steam_avatar_url: null }]));

test('buildScrimNightLeaderboard: wins first, then RWR%, then ADR; unscored matches ignored', () => {
  const matches = [
    // 1+2 beat 3+4 13-7.
    scrimMatch(1, '13-7', [line(1, 'SHIRTS', true, 20, 2000, 13), line(2, 'SHIRTS', true, 10, 1200, 13), line(3, 'SKINS', false, 15, 1800, 7), line(4, 'SKINS', false, 8, 900, 7)]),
    // 1+3 beat 2+5 13-11.
    scrimMatch(2, '13-11', [line(1, 'SHIRTS', true, 18, 1900, 13), line(3, 'SHIRTS', true, 12, 1500, 13), line(2, 'SKINS', false, 14, 1600, 11), line(5, 'SKINS', false, 9, 1000, 11)]),
    // Unscored lobby match: contributes nothing.
    scrimMatch(3, null, [line(5, 'SHIRTS', false, 0, 0, 0), line(4, 'SHIRTS', false, 0, 0, 0), line(2, 'SKINS', false, 0, 0, 0), line(3, 'SKINS', false, 0, 0, 0)]),
  ];
  const board = buildScrimNightLeaderboard(matches, PLAYERS);
  // 1 won both. 2 and 3 won one each; 2 won more rounds (24/40 vs 20/40), so leads on RWR%. 5 and 4
  // won none; 5 won more rounds (11/20 vs 7/20).
  assert.deepEqual(board.map((r) => r.player_id), [1, 2, 3, 5, 4]);
  assert.equal(board[0].wins, 2);
  assert.equal(board[0].matches, 2);
  assert.equal(board[0].player_name, 'P1');
  assert.equal(board.find((r) => r.player_id === 5)!.matches, 1, 'the unscored match is not counted');
});

function db(): FakeDb {
  const playerRows: Row[] = [1, 2, 3, 4].map((id) => ({ id, name: `P${id}`, steam_avatar_url: null }));
  const stat = (id: number, matchId: number, playerId: number, faction: string, won: boolean): Row => ({
    id, match_id: matchId, player_id: playerId, faction, kills: 10, assists: 0, deaths: 8, damage: 1500, adr: 75,
    rounds_played: 20, rounds_won: won ? 13 : 7, is_win: won,
  });
  return {
    players: playerRows,
    scrim_schedule: [{ id: 1, weekday: 4, start_time: '20:00:00', timezone: SCHEDULE.timezone, enabled: true }],
    scrim_nights: [
      { id: 1, night_date: PAST, cancelled: false },
      { id: 2, night_date: PAST_EMPTY, cancelled: false },
      { id: 3, night_date: UPCOMING, cancelled: false },
    ],
    scrim_signups: [{ id: 1, night_id: 3, player_id: 1, commitment: 'definite', signed_up_at: '2026-11-01T00:00:00Z', checked_in_at: null }],
    matches: [
      { id: 900, week_id: null, scrim_night_id: 1, match_number: 1, shirts_pick: 'Foroglio', skins_starting_side: null, final_score: '13-7' },
      // An unscored match on the empty past night: that night doesn't count as played.
      { id: 901, week_id: null, scrim_night_id: 2, match_number: 1, shirts_pick: 'Foroglio', skins_starting_side: null, final_score: null },
    ],
    player_match_stats: [
      stat(1, 900, 1, 'SHIRTS', true), stat(2, 900, 2, 'SHIRTS', true), stat(3, 900, 3, 'SKINS', false), stat(4, 900, 4, 'SKINS', false),
      stat(5, 901, 1, 'SHIRTS', false),
    ],
    match_server_state: [],
  };
}

__setTestAdminClient(createFakeSupabaseClient(db()));

async function main() {
  await test('getPastScrimNights: over and with a scored match, newest first', async () => {
    assert.deepEqual(await getPastScrimNights(NOW), [{ date: PAST, matches: 1, players: 4 }]);
  });

  await test('getScrimNight: a past night carries its matches and leaderboard', async () => {
    const night = await getScrimNight(PAST, NOW);
    assert.ok(night);
    assert.equal(night.current, false);
    assert.equal(night.startsAt, '2026-10-30T00:00:00.000Z'); // 8pm EDT
    assert.equal(night.matches.length, 1);
    assert.deepEqual(night.matches[0].shirts.sort(), [1, 2]);
    assert.deepEqual(night.leaderboard.slice(0, 2).map((r) => r.wins), [1, 1]);
  });

  await test('getScrimNight: the upcoming night is current, with its signups', async () => {
    const night = await getScrimNight(UPCOMING, NOW);
    assert.ok(night);
    assert.equal(night.current, true);
    assert.equal(night.checkInOpen, false);
    assert.deepEqual(night.signups.map((s) => s.player_id), [1]);
  });

  await test('getScrimMatchDetail: a scrim match with its night date and named stat rows; null for a league match', async () => {
    const detail = await getScrimMatchDetail(900);
    assert.ok(detail);
    assert.equal(detail.night_date, PAST);
    assert.equal(detail.final_score, '13-7');
    assert.deepEqual(detail.stats.map((r) => r.player_name).sort(), ['P1', 'P2', 'P3', 'P4']);
    assert.equal(await getScrimMatchDetail(12345), null);
  });

  await test('getScrimNight: null for a date with no night', async () => {
    assert.equal(await getScrimNight('2026-10-15', NOW), null);
  });

  report();
}

await main();
