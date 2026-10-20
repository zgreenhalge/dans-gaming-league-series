/**
 * Tests for the home page's data layer: `queries/home.ts` (`getHomeGames`), `queries/seasons.ts` (`resolveHomeSeasons`),
 * `queries/myStats.ts` (`buildMyStats` / `getMyStats`), `getSeasonForm` / `buildSeasonForm` (`queries/leaderboard.ts`),
 * `rankDuos` / `rankRivals` / `bestFriendOf` / `worstNightmareOf` (`queries/h2h.ts`),
 * `findCurrentGauntletRound` (`queries/gauntlet.ts`) and the history-row helpers in
 * `queries/player.ts`. The DB-backed functions run against the shared fixture league; the pure ones
 * against small hand-built inputs.
 *
 * Run:  npx vitest run src/lib/queries-home.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestAdminClient } from './supabase-admin';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { duoStats, H2H_PLAYERS } from './test-support/h2hFixtures';
import { matchesSnapshot } from './test-support/snapshot';
import { test, report } from './test-support/miniTest';

__setTestAdminClient(createFakeSupabaseClient(buildFakeDb()));

import {
  bestFriendOf,
  buildGauntletHomeGames,
  buildMyStats,
  buildRegularHomeGames,
  buildSeasonForm,
  findCurrentGauntletRound,
  getH2HData,
  getHomeGames,
  getMyStats,
  getSeasonForm,
  getSeasons,
  isPlayedHistoryRow,
  lastPlayed,
  nextUpcoming,
  opponentNames,
  rankDuos,
  rankRivals,
  resolveHomeSeasons,
  worstNightmareOf,
  type GauntletRound,
  type H2HStats,
  type PlayerHistoryRow,
  type WeekWithMatches,
} from './queries';
import type { H2HData } from './h2h';
import type { LeaderboardRowWithId, Season } from './types';

// ─── Builders ────────────────────────────────────────────────────────────────

const PLAYER_STATS = { kills: 20, assists: 5, deaths: 15, adr: 75, rwr: 57, roundsWon: 40, roundsPlayed: 70 };

function rival(playerA: number, playerB: number, aWins: number, bWins: number): H2HStats {
  return {
    playerA,
    playerB,
    meetings: aWins + bWins,
    aWins,
    bWins,
    lastMap: null,
    aStats: { ...PLAYER_STATS, roundsWon: 13 * aWins },
    bStats: { ...PLAYER_STATS, roundsWon: 13 * bWins },
    mapBreakdown: [],
    matches: [],
  };
}

function season(overrides: Partial<Season> & { id: number; name: string }): Season {
  return {
    status: 'ARCHIVED',
    target_win_rounds: 13,
    buy_in_amount: null,
    is_gauntlet: false,
    start_date: null,
    map_pool: null,
    ...overrides,
  };
}

function historyRow(overrides: Partial<PlayerHistoryRow> & { match_id: number }): PlayerHistoryRow {
  return {
    id: overrides.match_id,
    player_id: 1,
    faction: 'SHIRTS',
    kills: 10,
    assists: 2,
    deaths: 8,
    adr: 70,
    damage: 1500,
    rounds_played: 22,
    rounds_won: 13,
    is_win: true,
    match_number: 1,
    week_number: 1,
    season_id: 1,
    season_number: 1,
    season_name: 'Season 1',
    is_gauntlet: false,
    map: 'Foroglio',
    final_score: '13-9',
    scheduled_at: null,
    shirts: [{ player_id: 1, player_name: 'Alice' }, { player_id: 2, player_name: 'Bob' }],
    skins: [{ player_id: 3, player_name: 'Carol' }, { player_id: 4, player_name: 'Dave' }],
    shirts_stats: [],
    skins_stats: [],
    skins_pick: null,
    shirts_pick: null,
    skins_starting_side: null,
    shirts_ban: null,
    shirts_ban2: null,
    skins_ban1: null,
    skins_ban2: null,
    is_playoff_game: false,
    map_pool: null,
    replay_status: null,
    ...overrides,
  };
}

// ─── bestFriendOf / worstNightmareOf / rankDuos / rankRivals ─────────────────

test('bestFriendOf: the partner with the highest friendship rating, from either side of the pair', () => {
  const duos = [
    duoStats({ playerA: 1, playerB: 2, gamesPlayed: 5, wins: 3, losses: 2 }),
    duoStats({ playerA: 3, playerB: 1, gamesPlayed: 9, wins: 8, losses: 1 }),
  ];
  assert.deepEqual(bestFriendOf(duos, 1), { otherId: 3, wins: 8, losses: 1 });
  assert.deepEqual(bestFriendOf(duos, 3), { otherId: 1, wins: 8, losses: 1 });
  assert.deepEqual(bestFriendOf(duos, 2), { otherId: 1, wins: 3, losses: 2 });
});

test('bestFriendOf: null for a player with no partnered games', () => {
  const duos = [duoStats({ playerA: 1, playerB: 2 }), duoStats({ playerA: 1, playerB: 3, gamesPlayed: 0, wins: 0, losses: 0 })];
  assert.equal(bestFriendOf(duos, 9), null);
  assert.equal(bestFriendOf(duos, 3), null);
  assert.equal(bestFriendOf([], 1), null);
});

test('bestFriendOf: equal ratings break on the lower partner id', () => {
  const duos = [
    duoStats({ playerA: 1, playerB: 7 }),
    duoStats({ playerA: 1, playerB: 4 }),
    duoStats({ playerA: 1, playerB: 6 }),
  ];
  assert.equal(bestFriendOf(duos, 1)?.otherId, 4);
});

test('worstNightmareOf: the opponent with the biggest losses-minus-wins margin, from either side', () => {
  const rivals = [rival(1, 2, 1, 4), rival(1, 3, 2, 3), rival(5, 1, 6, 2)];
  // vs 2: 1-4 (margin 3). vs 3: 2-3 (margin 1). vs 5 (player 1 is B): 2-6 (margin 4).
  assert.deepEqual(worstNightmareOf(rivals, 1), { otherId: 5, wins: 2, losses: 6 });
  assert.deepEqual(worstNightmareOf([rival(1, 2, 1, 4), rival(1, 3, 2, 3)], 1), { otherId: 2, wins: 1, losses: 4 });
});

test('worstNightmareOf: null when nobody has a winning record against the player', () => {
  const rivals = [rival(1, 2, 4, 1), rival(1, 3, 2, 2)];
  assert.equal(worstNightmareOf(rivals, 1), null);
  assert.equal(worstNightmareOf(rivals, 9), null);
  assert.equal(worstNightmareOf([], 1), null);
});

test('worstNightmareOf: an equal margin goes to the opponent met more often, then the lower id', () => {
  assert.equal(worstNightmareOf([rival(1, 2, 0, 1), rival(1, 3, 1, 2)], 1)?.otherId, 3);
  assert.equal(worstNightmareOf([rival(1, 6, 0, 2), rival(1, 4, 0, 2)], 1)?.otherId, 4);
});

test('rankDuos / rankRivals: best first, capped at the limit, never-played pairs excluded, ratings 0-100', () => {
  const duos = [
    duoStats({ playerA: 1, playerB: 2, gamesPlayed: 2, wins: 1, losses: 1 }),
    duoStats({ playerA: 1, playerB: 3, gamesPlayed: 9, wins: 8, losses: 1 }),
    duoStats({ playerA: 2, playerB: 3, gamesPlayed: 0, wins: 0, losses: 0 }),
  ];
  const rankedDuos = rankDuos(duos, 5);
  assert.deepEqual(rankedDuos.map((r) => [r.duo.playerA, r.duo.playerB]), [[1, 3], [1, 2]]);
  assert.ok(rankedDuos.every((r) => r.rating >= 0 && r.rating <= 100));
  assert.equal(rankDuos(duos, 1).length, 1);

  const rivals = [rival(1, 2, 1, 1), rival(1, 3, 6, 6), rival(2, 3, 0, 0)];
  const rankedRivals = rankRivals(rivals, 5);
  assert.deepEqual(rankedRivals.map((r) => [r.rival.playerA, r.rival.playerB]), [[1, 3], [1, 2]]);
  assert.equal(rankedRivals[0].rating, 100);
  assert.equal(rankRivals(rivals, 1).length, 1);
});

// ─── buildSeasonForm / getSeasonForm ─────────────────────────────────────────

test('buildSeasonForm: each player\'s results newest first (week, then match number), capped at the limit', () => {
  const matches = [
    { id: 1, weekNumber: 1, matchNumber: 1 },
    { id: 2, weekNumber: 1, matchNumber: 2 },
    { id: 3, weekNumber: 2, matchNumber: 1 },
  ];
  const stats = [
    { match_id: 1, player_id: 10, is_win: true },
    { match_id: 2, player_id: 10, is_win: false },
    { match_id: 3, player_id: 10, is_win: true },
    { match_id: 1, player_id: 11, is_win: false },
    { match_id: 99, player_id: 11, is_win: true }, // not a played match of this season: ignored
  ];
  const form = buildSeasonForm(matches, stats, 2);
  assert.deepEqual(form.get(10), [true, false]);
  assert.deepEqual(form.get(11), [false]);
  assert.equal(form.get(12), undefined);
  assert.deepEqual(buildSeasonForm(matches, stats).get(10), [true, false, true]);
});

test('getSeasonForm: a season\'s played matches only — unscored and 0-0 placeholders do not count', async () => {
  const form = await getSeasonForm(1);
  matchesSnapshot('getSeasonForm-season1', form);
  // Season 5 (id 1): match 100 is played (13-9), 101 is unscored and 102 is a 0-0 placeholder.
  assert.deepEqual(form.get(1), [true]);
  assert.deepEqual(form.get(3), [false]);
  assert.equal(form.get(5), undefined);
});

test('getSeasonForm: a season with no weeks or no played matches is empty', async () => {
  assert.equal((await getSeasonForm(999)).size, 0);
  assert.equal((await getSeasonForm(3)).size, 0);
});

// ─── History-row helpers ─────────────────────────────────────────────────────

test('isPlayedHistoryRow / lastPlayed / nextUpcoming / opponentNames', () => {
  const history = [
    historyRow({ match_id: 5, final_score: null, rounds_played: 0 }), // upcoming, later
    historyRow({ match_id: 4, final_score: '0-0', rounds_played: 0 }), // placeholder, upcoming, earlier
    historyRow({ match_id: 3, final_score: '13-9' }),
    historyRow({ match_id: 2, final_score: '9-13', is_win: false }),
    historyRow({ match_id: 1, final_score: '13-1' }),
  ];
  assert.deepEqual(history.map(isPlayedHistoryRow), [false, false, true, true, true]);
  assert.deepEqual(lastPlayed(history, 2).map((r) => r.match_id), [3, 2]);
  assert.deepEqual(lastPlayed(history, 10).map((r) => r.match_id), [3, 2, 1]);
  assert.equal(nextUpcoming(history)?.match_id, 4);
  assert.equal(nextUpcoming(history.slice(2)), null);

  assert.equal(opponentNames(historyRow({ match_id: 1 })), 'Carol & Dave');
  assert.equal(opponentNames(historyRow({ match_id: 1, faction: 'SKINS' })), 'Alice & Bob');
  assert.equal(opponentNames(historyRow({ match_id: 1, skins: [] })), 'TBD');
});

// ─── buildMyStats ────────────────────────────────────────────────────────────

function leaderboardRow(
  playerId: number,
  name: string,
  won: number,
  lost: number,
  rwr: number,
  adr: number,
  overrides: Partial<LeaderboardRowWithId> = {},
): LeaderboardRowWithId {
  return {
    season_id: 0,
    player_id: playerId,
    player_name: name,
    matches_played: won + lost,
    matches_won: won,
    matches_lost: lost,
    win_rate_percentage: 0,
    total_kills: 0,
    total_assists: 0,
    total_deaths: 0,
    kd_ratio: 0,
    total_damage: 0,
    total_rounds_played: 100,
    total_rounds_won: 0,
    rwr_percentage: rwr,
    overall_adr: adr,
    kills_in_wins: 0,
    deaths_in_wins: 0,
    kills_in_losses: 0,
    deaths_in_losses: 0,
    ...overrides,
  };
}

test('buildMyStats: career EHOG, record, KDA, ADR, next match, recent matches, best friend and worst nightmare', () => {
  const h2h: H2HData = {
    duos: [duoStats({ playerA: 1, playerB: 2, gamesPlayed: 5, wins: 3, losses: 2 })],
    rivals: [rival(1, 3, 1, 4)],
    players: [...H2H_PLAYERS, { id: 3, name: 'Carol', steam_avatar_url: null }],
  };
  const history = [
    historyRow({ match_id: 9, final_score: null, rounds_played: 0, scheduled_at: '2026-10-25T19:30:00Z', map: 'Harbor' }),
    historyRow({ match_id: 8, final_score: '13-9' }),
    historyRow({ match_id: 7, final_score: '9-13', is_win: false, faction: 'SKINS' }),
  ];
  const stats = buildMyStats({
    playerId: 1,
    playerName: 'Alice',
    leaderboard: [
      leaderboardRow(2, 'Bob', 5, 5, 50, 70),
      leaderboardRow(1, 'Alice', 8, 2, 55, 80, { total_kills: 100, total_assists: 30, total_deaths: 50 }),
      leaderboardRow(3, 'Carol', 8, 2, 54, 79),
    ],
    ehog: 23.4,
    history,
    h2h,
  });

  assert.equal(stats.ehog, 23.4);
  assert.deepEqual(stats.record, { wins: 8, losses: 2 });
  assert.equal(stats.kda, 2.6);
  assert.equal(stats.kd, 2);
  assert.equal(stats.adr, 80);
  assert.deepEqual(stats.next, { matchId: 9, opponents: 'Carol & Dave', map: 'Harbor', scheduledAt: '2026-10-25T19:30:00Z' });
  assert.deepEqual(stats.recent, [
    { matchId: 8, won: true, score: '13-9', opponents: 'Carol & Dave', map: 'Foroglio' },
    { matchId: 7, won: false, score: '9-13', opponents: 'Alice & Bob', map: 'Foroglio' },
  ]);
  assert.deepEqual(stats.bestFriend, { id: 2, name: 'Bob', wins: 3, losses: 2 });
  assert.deepEqual(stats.worstNightmare, { id: 3, name: 'Carol', wins: 1, losses: 4 });
});

test('buildMyStats: a player with no matches has no rating, record, KDA, history or matchups', () => {
  const stats = buildMyStats({
    playerId: 7,
    playerName: 'Grace',
    leaderboard: [leaderboardRow(1, 'Alice', 8, 2, 55, 80)],
    ehog: null,
    history: [],
    h2h: { duos: [], rivals: [], players: H2H_PLAYERS },
  });
  assert.equal(stats.ehog, null);
  assert.deepEqual(stats.record, { wins: 0, losses: 0 });
  assert.equal(stats.kda, 0);
  assert.equal(stats.kd, 0);
  assert.equal(stats.adr, 0);
  assert.equal(stats.next, null);
  assert.deepEqual(stats.recent, []);
  assert.equal(stats.bestFriend, null);
  assert.equal(stats.worstNightmare, null);
});

// ─── resolveHomeSeasons (standings) ──────────────────────────────────────────

const standingsOf = (seasons: Parameters<typeof resolveHomeSeasons>[0]) => resolveHomeSeasons(seasons).standings;

test('resolveHomeSeasons standings: the active regular season, live, with its running gauntlet', () => {
  const picked = standingsOf([
    season({ id: 1, name: 'Season 3' }),
    season({ id: 2, name: 'Season 4', status: 'ACTIVE' }),
    season({ id: 3, name: 'Season 4 Gauntlet', status: 'ACTIVE', is_gauntlet: true }),
    season({ id: 4, name: 'Season 5', status: 'UPCOMING' }),
  ]);
  assert.equal(picked?.season.id, 2);
  assert.equal(picked?.live, true);
  assert.equal(picked?.gauntlet?.id, 3);
});

test('resolveHomeSeasons standings: with nothing active, the latest finished regular season by season number', () => {
  const picked = standingsOf([
    season({ id: 9, name: 'Season 2' }),
    season({ id: 3, name: 'Season 10' }),
    season({ id: 5, name: 'Season 3 Gauntlet', is_gauntlet: true }),
    season({ id: 6, name: 'Season 11', status: 'UPCOMING' }),
  ]);
  assert.equal(picked?.season.id, 3);
  assert.equal(picked?.live, false);
  assert.equal(picked?.gauntlet, null);
});

test('resolveHomeSeasons standings: a finished season whose gauntlet is not running has no gauntlet pointer; none at all is null', () => {
  const picked = standingsOf([
    season({ id: 1, name: 'Season 1' }),
    season({ id: 2, name: 'Season 1 Gauntlet', is_gauntlet: true }),
  ]);
  assert.equal(picked?.gauntlet, null);
  assert.equal(standingsOf([season({ id: 1, name: 'Season 1', status: 'UPCOMING' })]), null);
  assert.equal(standingsOf([]), null);
});

// ─── Games: week / round links ───────────────────────────────────────────────

function weekWith(id: number, weekNumber: number, matches: Partial<WeekWithMatches['matches'][number]>[]): WeekWithMatches {
  return {
    id,
    season_id: 3,
    week_number: weekNumber,
    bye_player_id: null,
    bye_player_name: null,
    matches: matches as WeekWithMatches['matches'],
  };
}

test('buildRegularHomeGames: the heading links to the current week, To Be Scheduled to the Schedule tab', () => {
  const schedule = [
    weekWith(31, 1, [{ id: 1, match_number: 1, final_score: '13-9', scheduled_at: null }]),
    weekWith(32, 2, [{ id: 2, match_number: 1, final_score: null, scheduled_at: null }]),
  ];
  // Without a start date the current week is the first one with matches — week 1; a start date
  // far in the past leaves the last week as "current".
  assert.equal(buildRegularHomeGames({ id: 3, start_date: null }, schedule).headingHref, '/seasons/3/weeks/31');
  const past = buildRegularHomeGames({ id: 3, start_date: '2000-01-01' }, schedule);
  assert.equal(past.headingHref, '/seasons/3/weeks/32');
  assert.equal(past.scheduleHref, '/seasons/3?tab=schedule');
  assert.deepEqual(past.unscheduled.map((m) => m.id), [2]);
});

test('buildRegularHomeGames: no weeks falls back to the season hub', () => {
  assert.equal(buildRegularHomeGames({ id: 3, start_date: null }, []).headingHref, '/seasons/3');
});

function gauntletMatch(id: number, finalScore: string | null, scheduledAt: string | null): GauntletRound['matches'][number] {
  return {
    id,
    match_number: id,
    final_score: finalScore,
    scheduled_at: scheduledAt,
    skins_pick: null,
    shirts_pick: null,
    skins_starting_side: null,
    is_feature_match: false,
    shirts_stats: [],
    skins_stats: [],
    pod_index: 0,
    advance_rule: null,
  };
}

test('findCurrentGauntletRound: the first round with an unplayed match, else the last round', () => {
  const rounds: GauntletRound[] = [
    { round_number: 2, matches: [gauntletMatch(3, null, null)], is_final_round: true },
    { round_number: 1, matches: [gauntletMatch(1, '13-9', null), gauntletMatch(2, '13-5', null)], is_final_round: false },
  ];
  assert.equal(findCurrentGauntletRound(rounds)?.round_number, 2);
  const allPlayed = rounds.map((r) => ({ ...r, matches: r.matches.map((m) => ({ ...m, final_score: '13-9' })) }));
  assert.equal(findCurrentGauntletRound(allPlayed)?.round_number, 2);
  assert.equal(findCurrentGauntletRound([]), null);
});

test('buildGauntletHomeGames: links hang off the hub season; every unplayed bracket match counts', () => {
  const rounds: GauntletRound[] = [
    { round_number: 1, matches: [gauntletMatch(1, '13-9', null)], is_final_round: false },
    { round_number: 2, matches: [gauntletMatch(2, null, '2026-10-30T20:00:00Z'), gauntletMatch(3, null, null)], is_final_round: true },
  ];
  const games = buildGauntletHomeGames(7, rounds);
  assert.deepEqual(games.scheduled.map((m) => m.id), [2]);
  assert.deepEqual(games.unscheduled.map((m) => m.id), [3]);
  assert.equal(games.headingHref, '/seasons/7/rounds/2');
  assert.equal(games.scheduleHref, '/seasons/7?view=gauntlet&tab=schedule');
  assert.equal(buildGauntletHomeGames(7, []).headingHref, '/seasons/7?view=gauntlet');
});

test('getHomeGames: the active regular season of the fixture league', async () => {
  const seasons = await getSeasons();
  const games = await getHomeGames(resolveHomeSeasons(seasons));
  matchesSnapshot('getHomeGames', games);
  assert.ok(games);
  assert.equal(games.scheduleHref, '/seasons/3?tab=schedule');
});

test('getHomeGames: null when no season is active', async () => {
  const seasons = (await getSeasons()).map((s) => ({ ...s, status: 'ARCHIVED' as const }));
  assert.equal(await getHomeGames(resolveHomeSeasons(seasons)), null);
});

test('getMyStats: assembled from the career leaderboard, player history and career H2H', async () => {
  const h2h = await getH2HData({ filter: 'career', includeRegular: true, includeGauntlet: true });
  const stats = await getMyStats(1, h2h);
  matchesSnapshot('getMyStats-player1', stats);
  assert.ok(stats);
  assert.equal(stats.playerName, 'Alice');
  assert.equal(stats.record.wins, 2);
  assert.equal(await getMyStats(9999, h2h), null);
});

report();
