/**
 * Regression tests for `computeH2H` (h2h.ts) — the shared duo/rival aggregation
 * core behind the H2H tab, `getH2HData` (queries/h2h.ts), and the client-side
 * call sites (CareerStatsView, MapDetailView) that compute H2H directly from
 * already-loaded match history.
 *
 * Assertions are plain `node:assert`, no matcher library (mirrors util.test.ts). Run:
 *   npx vitest run src/lib/h2h.test.ts
 */

import assert from 'node:assert/strict';
import { computeH2H, findDuo, findRival, duoAvgKda, mapMatchRowsToH2HInput, scheduleToH2HInput, gauntletRoundsToH2HInput, type H2HMatchInput, type H2HRosterRow } from './h2h';
import { test, report } from './test-support/miniTest';

const players = new Map<number, { name: string; steam_avatar_url: string | null }>([
  [1, { name: 'Alice', steam_avatar_url: null }],
  [2, { name: 'Bob', steam_avatar_url: null }],
  [3, { name: 'Cara', steam_avatar_url: null }],
  [4, { name: 'Dee', steam_avatar_url: null }],
]);

function stat(overrides: Partial<H2HRosterRow> & { player_id: number; faction: 'SHIRTS' | 'SKINS' }): H2HRosterRow {
  return {
    kills: 10,
    assists: 2,
    deaths: 8,
    adr: 80,
    is_win: true,
    rounds_won: 13,
    rounds_played: 24,
    ...overrides,
  };
}

function match(overrides: Partial<H2HMatchInput> & { matchId: number; roster: H2HRosterRow[] }): H2HMatchInput {
  return {
    weekNumber: 1,
    matchNumber: 1,
    seasonNumber: 1,
    isGauntlet: false,
    map: 'de_test',
    shirtsWinProb: null,
    pickedBy: null,
    startingSide: null,
    finalScore: '13-9',
    ...overrides,
  };
}

// --- Empty input ---
test('empty input returns empty duos/rivals/players', () => {
  const result = computeH2H([], players);
  assert.deepEqual(result, { duos: [], rivals: [], players: [] });
});

// --- Partner/opponent grouping is faction-based ---
test('2v2 match produces 2 duo pairs (one per team) and 4 rival pairs (cross-team)', () => {
  const roster = [
    stat({ player_id: 1, faction: 'SHIRTS', is_win: true }),
    stat({ player_id: 2, faction: 'SHIRTS', is_win: true }),
    stat({ player_id: 3, faction: 'SKINS', is_win: false }),
    stat({ player_id: 4, faction: 'SKINS', is_win: false }),
  ];
  const result = computeH2H([match({ matchId: 1, roster })], players);
  assert.equal(result.duos.length, 2, 'one duo per team');
  assert.equal(result.rivals.length, 4, 'every shirts x skins pairing');
  assert.ok(result.duos.some((d) => d.playerA === 1 && d.playerB === 2));
  assert.ok(result.duos.some((d) => d.playerA === 3 && d.playerB === 4));
  assert.ok(result.rivals.some((r) => r.playerA === 1 && r.playerB === 3));
});

// --- Rounds counted once per match for teammates, not doubled ---
test('teammates share round totals — counted once, not summed per pair', () => {
  const roster = [
    stat({ player_id: 1, faction: 'SHIRTS', rounds_won: 13, rounds_played: 24 }),
    stat({ player_id: 2, faction: 'SHIRTS', rounds_won: 13, rounds_played: 24 }),
    stat({ player_id: 3, faction: 'SKINS', rounds_won: 11, rounds_played: 24, is_win: false }),
    stat({ player_id: 4, faction: 'SKINS', rounds_won: 11, rounds_played: 24, is_win: false }),
  ];
  const result = computeH2H([match({ matchId: 1, roster })], players);
  const duo = result.duos.find((d) => d.playerA === 1 && d.playerB === 2)!;
  assert.equal(duo.roundsWon, 13, 'not 26 — teammates share one round total, counted once');
  assert.equal(duo.roundsPlayed, 24);
});

// --- bestMap tie handling ---
test('bestMap is null when two maps are tied for most duo wins', () => {
  const rosterFor = () => [
    stat({ player_id: 1, faction: 'SHIRTS', is_win: true }),
    stat({ player_id: 2, faction: 'SHIRTS', is_win: true }),
    stat({ player_id: 3, faction: 'SKINS', is_win: false }),
    stat({ player_id: 4, faction: 'SKINS', is_win: false }),
  ];
  const result = computeH2H(
    [
      match({ matchId: 1, map: 'de_dust2', roster: rosterFor() }),
      match({ matchId: 2, map: 'de_mirage', roster: rosterFor() }),
    ],
    players,
  );
  const duo = result.duos.find((d) => d.playerA === 1 && d.playerB === 2)!;
  assert.equal(duo.bestMap, null, 'one win each on two different maps is a tie');
});

test('bestMap resolves to the single map with the most duo wins', () => {
  const roster = [
    stat({ player_id: 1, faction: 'SHIRTS', is_win: true }),
    stat({ player_id: 2, faction: 'SHIRTS', is_win: true }),
    stat({ player_id: 3, faction: 'SKINS', is_win: false }),
    stat({ player_id: 4, faction: 'SKINS', is_win: false }),
  ];
  const result = computeH2H([match({ matchId: 1, map: 'de_inferno', roster })], players);
  const duo = result.duos.find((d) => d.playerA === 1 && d.playerB === 2)!;
  assert.equal(duo.bestMap, 'de_inferno');
});

// --- Null assists treated as 0 (defense-in-depth for callers that pass raw DB rows) ---
test('null assists do not produce NaN', () => {
  const roster = [
    stat({ player_id: 1, faction: 'SHIRTS', assists: null as unknown as number }),
    stat({ player_id: 2, faction: 'SHIRTS', assists: null as unknown as number }),
    stat({ player_id: 3, faction: 'SKINS', assists: null as unknown as number, is_win: false }),
    stat({ player_id: 4, faction: 'SKINS', assists: null as unknown as number, is_win: false }),
  ];
  const result = computeH2H([match({ matchId: 1, roster })], players);
  const duo = result.duos.find((d) => d.playerA === 1 && d.playerB === 2)!;
  const rival = result.rivals.find((r) => r.playerA === 1 && r.playerB === 3)!;
  assert.equal(duo.combinedAssists, 0);
  assert.equal(rival.aStats.assists, 0);
});

// --- Matches sorted most-recent-first ---
test('duo/rival match history sorts most-recent-first', () => {
  const rosterFor = () => [
    stat({ player_id: 1, faction: 'SHIRTS' }),
    stat({ player_id: 2, faction: 'SHIRTS' }),
    stat({ player_id: 3, faction: 'SKINS', is_win: false }),
    stat({ player_id: 4, faction: 'SKINS', is_win: false }),
  ];
  const result = computeH2H(
    [
      match({ matchId: 1, seasonNumber: 1, weekNumber: 1, matchNumber: 1, roster: rosterFor() }),
      match({ matchId: 2, seasonNumber: 2, weekNumber: 1, matchNumber: 1, roster: rosterFor() }),
      match({ matchId: 3, seasonNumber: 1, weekNumber: 3, matchNumber: 1, roster: rosterFor() }),
    ],
    players,
  );
  const duo = result.duos.find((d) => d.playerA === 1 && d.playerB === 2)!;
  assert.deepEqual(duo.matches.map((m) => m.matchId), [2, 3, 1], 'season 2 first, then season 1 wk 3, then season 1 wk 1');
});

// --- rwr/adr derivation guards division by zero ---
test('rwr is 0 (not NaN) when rounds_played is 0', () => {
  const roster = [
    stat({ player_id: 1, faction: 'SHIRTS', rounds_won: 0, rounds_played: 0 }),
    stat({ player_id: 2, faction: 'SHIRTS', rounds_won: 0, rounds_played: 0 }),
    stat({ player_id: 3, faction: 'SKINS', rounds_won: 0, rounds_played: 0, is_win: false }),
    stat({ player_id: 4, faction: 'SKINS', rounds_won: 0, rounds_played: 0, is_win: false }),
  ];
  const result = computeH2H([match({ matchId: 1, roster })], players);
  const rival = result.rivals.find((r) => r.playerA === 1 && r.playerB === 3)!;
  assert.equal(rival.aStats.rwr, 0);
  assert.equal(Number.isNaN(rival.aStats.rwr), false);
});

// --- players list ---
test('players list only includes players who actually appeared, sorted by name', () => {
  const roster = [
    stat({ player_id: 4, faction: 'SHIRTS' }),
    stat({ player_id: 1, faction: 'SHIRTS' }),
    stat({ player_id: 3, faction: 'SKINS', is_win: false }),
    stat({ player_id: 2, faction: 'SKINS', is_win: false }),
  ];
  const result = computeH2H([match({ matchId: 1, roster })], players);
  assert.deepEqual(result.players.map((p) => p.name), ['Alice', 'Bob', 'Cara', 'Dee']);
});

// --- MapMatchRow adapter (functional-equivalence check for the client-side path) ---
test('mapMatchRowsToH2HInput adapts a MapMatchRow-shaped source into computeH2H input', () => {
  const source = [
    {
      match_id: 42,
      match_number: 2,
      week_number: 5,
      season_number: 3,
      is_gauntlet: false,
      final_score: '13-7',
      pre_match_win_prob: 0.7,
      skins_pick: null,
      shirts_pick: 'de_overpass',
      skins_starting_side: 'CT' as const,
      shirts_stats: [
        { player_id: 1, faction: 'SHIRTS' as const, kills: 20, assists: 3, deaths: 10, adr: 90, rounds_played: 20, rounds_won: 13, is_win: true },
        { player_id: 2, faction: 'SHIRTS' as const, kills: 18, assists: 5, deaths: 12, adr: 85, rounds_played: 20, rounds_won: 13, is_win: true },
      ],
      skins_stats: [
        { player_id: 3, faction: 'SKINS' as const, kills: 12, assists: 2, deaths: 20, adr: 60, rounds_played: 20, rounds_won: 7, is_win: false },
        { player_id: 4, faction: 'SKINS' as const, kills: 14, assists: 1, deaths: 19, adr: 65, rounds_played: 20, rounds_won: 7, is_win: false },
      ],
    },
  ];
  const inputs = mapMatchRowsToH2HInput(source);
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].map, 'de_overpass', 'falls back to shirts_pick when skins_pick is null');
  assert.equal(inputs[0].pickedBy, 'SHIRTS', 'shirts_pick set means shirts picked');
  assert.equal(inputs[0].startingSide, 'CT');
  assert.equal(inputs[0].shirtsWinProb, 0.7);
  assert.equal(inputs[0].roster.length, 4);

  const result = computeH2H(inputs, players);
  assert.equal(result.duos.length, 2);
  assert.equal(result.rivals.length, 4);
  const duo = result.duos.find((d) => d.playerA === 1 && d.playerB === 2)!;
  assert.equal(duo.bestMap, 'de_overpass');
});

// --- Per-pair map breakdown ---
test('mapBreakdown aggregates duo and rival records per map, sorted by games desc', () => {
  const roster1 = [
    stat({ player_id: 1, faction: 'SHIRTS', is_win: true, adr: 100 }),
    stat({ player_id: 2, faction: 'SHIRTS', is_win: true, adr: 80 }),
    stat({ player_id: 3, faction: 'SKINS', is_win: false, adr: 60 }),
    stat({ player_id: 4, faction: 'SKINS', is_win: false, adr: 50 }),
  ];
  const roster2 = [
    stat({ player_id: 1, faction: 'SHIRTS', is_win: false, adr: 70 }),
    stat({ player_id: 2, faction: 'SHIRTS', is_win: false, adr: 60 }),
    stat({ player_id: 3, faction: 'SKINS', is_win: true, adr: 90 }),
    stat({ player_id: 4, faction: 'SKINS', is_win: true, adr: 95 }),
  ];
  const roster3 = [
    stat({ player_id: 1, faction: 'SHIRTS', is_win: true, adr: 110 }),
    stat({ player_id: 2, faction: 'SHIRTS', is_win: true, adr: 90 }),
    stat({ player_id: 3, faction: 'SKINS', is_win: false, adr: 65 }),
    stat({ player_id: 4, faction: 'SKINS', is_win: false, adr: 55 }),
  ];
  const result = computeH2H(
    [
      match({ matchId: 1, roster: roster1, map: 'de_mirage' }),
      match({ matchId: 2, roster: roster2, map: 'de_inferno' }),
      match({ matchId: 3, roster: roster3, map: 'de_mirage' }),
    ],
    players,
  );

  const duo = result.duos.find((d) => d.playerA === 1 && d.playerB === 2)!;
  assert.equal(duo.mapBreakdown.length, 2);
  assert.equal(duo.mapBreakdown[0].map, 'de_mirage', 'sorted by games desc — mirage played twice');
  assert.equal(duo.mapBreakdown[0].games, 2);
  assert.equal(duo.mapBreakdown[0].wins, 2);
  assert.equal(duo.mapBreakdown[0].losses, 0);
  assert.equal(duo.mapBreakdown[0].aAdr, (100 + 80 + 110 + 90) / 2);
  assert.equal(duo.mapBreakdown[1].map, 'de_inferno');
  assert.equal(duo.mapBreakdown[1].games, 1);
  assert.equal(duo.mapBreakdown[1].wins, 0);

  const rival = result.rivals.find((r) => r.playerA === 1 && r.playerB === 3)!;
  assert.equal(rival.mapBreakdown.length, 2);
  const mirage = rival.mapBreakdown.find((m) => m.map === 'de_mirage')!;
  assert.equal(mirage.games, 2);
  assert.equal(mirage.wins, 2, 'playerA (1) won both mirage meetings');
  assert.equal(mirage.aAdr, (100 + 110) / 2);
  assert.equal(mirage.bAdr, (60 + 65) / 2);
});

// --- Veto context propagation ---
test('pickedBy and startingSide propagate onto duo and rival match summaries', () => {
  const roster = [
    stat({ player_id: 1, faction: 'SHIRTS' }),
    stat({ player_id: 2, faction: 'SHIRTS' }),
    stat({ player_id: 3, faction: 'SKINS', is_win: false }),
    stat({ player_id: 4, faction: 'SKINS', is_win: false }),
  ];
  const result = computeH2H(
    [match({ matchId: 1, roster, pickedBy: 'SKINS', startingSide: 'T' })],
    players,
  );
  const duo = result.duos.find((d) => d.playerA === 1 && d.playerB === 2)!;
  assert.equal(duo.matches[0].pickedBy, 'SKINS');
  assert.equal(duo.matches[0].startingSide, 'T');
  const rival = result.rivals.find((r) => r.playerA === 1 && r.playerB === 3)!;
  assert.equal(rival.matches[0].pickedBy, 'SKINS');
  assert.equal(rival.matches[0].startingSide, 'T');
});

// --- Gauntlet matches have no veto data ---
test('pickedBy/startingSide are null when no veto data is available (e.g. gauntlet matches)', () => {
  const roster = [
    stat({ player_id: 1, faction: 'SHIRTS' }),
    stat({ player_id: 2, faction: 'SKINS', is_win: false }),
  ];
  const result = computeH2H([match({ matchId: 1, roster, isGauntlet: true })], players);
  assert.equal(result.rivals[0].matches[0].pickedBy, null);
  assert.equal(result.rivals[0].matches[0].startingSide, null);
});

// --- Rival match rosters (playerA/playerB + their 2v2 teammate) ---
test('rival match aTeam/bTeam carry both players on each side, with their own stats', () => {
  const roster = [
    stat({ player_id: 1, faction: 'SHIRTS', kills: 20, assists: 3, deaths: 10, adr: 90 }),
    stat({ player_id: 2, faction: 'SHIRTS', kills: 18, assists: 5, deaths: 12, adr: 85 }),
    stat({ player_id: 3, faction: 'SKINS', kills: 15, assists: 1, deaths: 14, adr: 70, is_win: false }),
    stat({ player_id: 4, faction: 'SKINS', kills: 12, assists: 4, deaths: 16, adr: 65, is_win: false }),
  ];
  const result = computeH2H([match({ matchId: 1, roster })], players);

  const rival = result.rivals.find((r) => r.playerA === 1 && r.playerB === 3)!;
  const m = rival.matches[0];
  assert.equal(m.aTeam.length, 2, 'playerA (1) + their SHIRTS teammate (2)');
  assert.deepEqual(new Set(m.aTeam.map((p) => p.player_id)), new Set([1, 2]));
  assert.equal(m.bTeam.length, 2, 'playerB (3) + their SKINS teammate (4)');
  assert.deepEqual(new Set(m.bTeam.map((p) => p.player_id)), new Set([3, 4]));

  const teammateTwo = m.aTeam.find((p) => p.player_id === 2)!;
  assert.equal(teammateTwo.player_name, 'Bob');
  assert.equal(teammateTwo.kills, 18);
  assert.equal(teammateTwo.assists, 5);
  assert.equal(teammateTwo.deaths, 12);
  assert.equal(teammateTwo.adr, 85);
});

// --- Duo match rosters (playerA/playerB's own team + the opposing roster) ---
test('duo match team/opponents carry both rosters, with their own stats', () => {
  const roster = [
    stat({ player_id: 1, faction: 'SHIRTS', kills: 20, assists: 3, deaths: 10, adr: 90 }),
    stat({ player_id: 2, faction: 'SHIRTS', kills: 18, assists: 5, deaths: 12, adr: 85 }),
    stat({ player_id: 3, faction: 'SKINS', kills: 15, assists: 1, deaths: 14, adr: 70, is_win: false }),
    stat({ player_id: 4, faction: 'SKINS', kills: 12, assists: 4, deaths: 16, adr: 65, is_win: false }),
  ];
  const result = computeH2H([match({ matchId: 1, roster })], players);

  const duo = result.duos.find((d) => d.playerA === 1 && d.playerB === 2)!;
  const m = duo.matches[0];
  assert.equal(m.team.length, 2, 'playerA (1) + playerB (2), their own SHIRTS roster');
  assert.deepEqual(new Set(m.team.map((p) => p.player_id)), new Set([1, 2]));
  assert.equal(m.opponents.length, 2, 'the opposing SKINS roster');
  assert.deepEqual(new Set(m.opponents.map((p) => p.player_id)), new Set([3, 4]));

  const opponentFour = m.opponents.find((p) => p.player_id === 4)!;
  assert.equal(opponentFour.player_name, 'Dee');
  assert.equal(opponentFour.kills, 12);
  assert.equal(opponentFour.assists, 4);
  assert.equal(opponentFour.deaths, 16);
  assert.equal(opponentFour.adr, 65);
});

// --- findDuo / findRival: order-agnostic lookup on computeH2H's own output ---
test('findDuo/findRival find a pair regardless of which side is playerA/playerB', () => {
  const roster = [
    stat({ player_id: 1, faction: 'SHIRTS' }),
    stat({ player_id: 2, faction: 'SHIRTS' }),
    stat({ player_id: 3, faction: 'SKINS', is_win: false }),
    stat({ player_id: 4, faction: 'SKINS', is_win: false }),
  ];
  const result = computeH2H([match({ matchId: 1, roster })], players);
  const [storedA, storedB] = [result.duos[0].playerA, result.duos[0].playerB];

  assert.equal(findDuo(result.duos, storedA, storedB), result.duos[0]);
  assert.equal(findDuo(result.duos, storedB, storedA), result.duos[0], 'order-agnostic');

  const [rivalA, rivalB] = [result.rivals[0].playerA, result.rivals[0].playerB];
  assert.equal(findRival(result.rivals, rivalA, rivalB), result.rivals[0]);
  assert.equal(findRival(result.rivals, rivalB, rivalA), result.rivals[0], 'order-agnostic');
});

test('findDuo/findRival return undefined for a pair that never played together', () => {
  const roster = [
    stat({ player_id: 1, faction: 'SHIRTS' }),
    stat({ player_id: 2, faction: 'SHIRTS' }),
    stat({ player_id: 3, faction: 'SKINS', is_win: false }),
    stat({ player_id: 4, faction: 'SKINS', is_win: false }),
  ];
  const result = computeH2H([match({ matchId: 1, roster })], players);
  assert.equal(findDuo(result.duos, 1, 999), undefined);
  assert.equal(findRival(result.rivals, 1, 999), undefined);
});

// --- scheduleToH2HInput / gauntletRoundsToH2HInput (season-page adapters) ---
function seasonSourceMatch(overrides: {
  id: number;
  match_number?: number;
  final_score?: string | null;
  shirts_stats?: H2HRosterRow[];
  skins_stats?: H2HRosterRow[];
}) {
  return {
    id: overrides.id,
    match_number: overrides.match_number ?? 1,
    final_score: overrides.final_score !== undefined ? overrides.final_score : '13-9',
    pre_match_win_prob: null,
    skins_pick: null,
    shirts_pick: 'de_test',
    skins_starting_side: null as 'CT' | 'T' | null,
    shirts_stats: overrides.shirts_stats ?? [],
    skins_stats: overrides.skins_stats ?? [],
  };
}

test('scheduleToH2HInput drops unplayed matches and stamps week/season number, isGauntlet false', () => {
  const roster = [stat({ player_id: 1, faction: 'SHIRTS' }), stat({ player_id: 2, faction: 'SKINS', is_win: false })];
  const weeks = [
    {
      week_number: 3,
      matches: [
        seasonSourceMatch({ id: 10, shirts_stats: [roster[0]], skins_stats: [roster[1]] }),
        seasonSourceMatch({ id: 11, final_score: null }), // unplayed — dropped
      ],
    },
  ];
  const inputs = scheduleToH2HInput(weeks, 5);
  assert.equal(inputs.length, 1, 'unplayed match filtered out');
  assert.equal(inputs[0].matchId, 10);
  assert.equal(inputs[0].weekNumber, 3);
  assert.equal(inputs[0].seasonNumber, 5);
  assert.equal(inputs[0].isGauntlet, false);

  const result = computeH2H(inputs, players);
  assert.equal(result.duos.length, 0, 'partnered players are on opposite factions here, not duos');
  assert.equal(result.rivals.length, 1);
});

test('gauntletRoundsToH2HInput drops unplayed matches and stamps round/season number, isGauntlet true', () => {
  const roster = [stat({ player_id: 1, faction: 'SHIRTS' }), stat({ player_id: 2, faction: 'SKINS', is_win: false })];
  const rounds = [
    {
      round_number: 2,
      matches: [
        seasonSourceMatch({ id: 20, shirts_stats: [roster[0]], skins_stats: [roster[1]] }),
        seasonSourceMatch({ id: 21, final_score: null }), // unplayed — dropped
      ],
    },
  ];
  const inputs = gauntletRoundsToH2HInput(rounds, 5);
  assert.equal(inputs.length, 1, 'unplayed match filtered out');
  assert.equal(inputs[0].matchId, 20);
  assert.equal(inputs[0].weekNumber, 2, 'round_number maps into weekNumber');
  assert.equal(inputs[0].seasonNumber, 5);
  assert.equal(inputs[0].isGauntlet, true);
});

// --- Performance inputs to the Friends and Rival ratings ---
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);

test('winsAboveExpected: sums each duo game as result minus the duo team\'s win probability, skipping games with no prediction', () => {
  const duoGame = (matchId: number, faction: 'SHIRTS' | 'SKINS', won: boolean, shirtsWinProb: number | null) =>
    match({
      matchId,
      shirtsWinProb,
      roster: [
        stat({ player_id: 1, faction, is_win: won }),
        stat({ player_id: 2, faction, is_win: won }),
        stat({ player_id: 3, faction: faction === 'SHIRTS' ? 'SKINS' : 'SHIRTS', is_win: !won }),
        stat({ player_id: 4, faction: faction === 'SHIRTS' ? 'SKINS' : 'SHIRTS', is_win: !won }),
      ],
    });
  const result = computeH2H(
    [
      duoGame(1, 'SHIRTS', true, 0.25), // won as shirts at 25%: +0.75
      duoGame(2, 'SKINS', false, 0.4), // lost as skins at 60%: −0.6
      duoGame(3, 'SHIRTS', true, null), // no stored prediction: 0
    ],
    players,
  );
  near(findDuo(result.duos, 1, 2)!.winsAboveExpected, 0.15);
  near(findDuo(result.duos, 3, 4)!.winsAboveExpected, -0.15); // the opposing pair mirrors it
});

test('upset scores: an underdog win counts how far below even the odds were, doubled; a favourite\'s win counts 0', () => {
  const meeting = (matchId: number, shirtsWinProb: number, shirtsWon: boolean) =>
    match({
      matchId,
      shirtsWinProb,
      roster: [
        stat({ player_id: 1, faction: 'SHIRTS', is_win: shirtsWon }),
        stat({ player_id: 2, faction: 'SKINS', is_win: !shirtsWon }),
      ],
    });
  const result = computeH2H(
    [
      meeting(1, 0.2, true), // player 1's team wins at 20%: 1 − 0.4 = 0.6
      meeting(2, 0.4, false), // player 2's team wins at 60%: a favourite, 0
      meeting(3, 0.7, false), // player 2's team wins at 30%: 1 − 0.6 = 0.4
      meeting(4, 0.8, true), // player 1's team wins at 80%: a favourite, 0
    ],
    players,
  );
  const rival = findRival(result.rivals, 1, 2)!;
  near(rival.aUpsetScore, 0.6);
  near(rival.bUpsetScore, 0.4);
});

test('adrLift: mean of each player\'s ADR with the partner over their ADR in every other game', () => {
  const result = computeH2H(
    [
      // Match 1: 1 and 2 partner (ADR 100 and 90) against 3 and 4.
      match({ matchId: 1, roster: [
        stat({ player_id: 1, faction: 'SHIRTS', adr: 100 }), stat({ player_id: 2, faction: 'SHIRTS', adr: 90 }),
        stat({ player_id: 3, faction: 'SKINS', adr: 80, is_win: false }), stat({ player_id: 4, faction: 'SKINS', adr: 80, is_win: false }),
      ] }),
      // Match 2: 1 and 3 partner, 2 and 4 partner (1 plays at ADR 80 and 2 at ADR 70 away from each other).
      match({ matchId: 2, roster: [
        stat({ player_id: 1, faction: 'SHIRTS', adr: 80 }), stat({ player_id: 3, faction: 'SHIRTS', adr: 80 }),
        stat({ player_id: 2, faction: 'SKINS', adr: 70, is_win: false }), stat({ player_id: 4, faction: 'SKINS', adr: 80, is_win: false }),
      ] }),
    ],
    players,
  );
  near(findDuo(result.duos, 1, 2)!.adrLift, (100 / 80 - 1 + (90 / 70 - 1)) / 2);
});

test('adrLift is 0 for a player whose every game was with the partner', () => {
  const roster = [
    stat({ player_id: 1, faction: 'SHIRTS', adr: 120 }), stat({ player_id: 2, faction: 'SHIRTS', adr: 120 }),
    stat({ player_id: 3, faction: 'SKINS', adr: 50, is_win: false }), stat({ player_id: 4, faction: 'SKINS', adr: 50, is_win: false }),
  ];
  const result = computeH2H([match({ matchId: 1, roster })], players);
  assert.equal(findDuo(result.duos, 1, 2)!.adrLift, 0);
});

test('duoAvgKda: mean of the two players own (K+A)/D, not the pooled ratio', () => {
  const a = { kills: 20, assists: 10, deaths: 10, adr: 0, rwr: 0, roundsWon: 0, roundsPlayed: 0 }; // 3
  const b = { kills: 4, assists: 0, deaths: 2, adr: 0, rwr: 0, roundsWon: 0, roundsPlayed: 0 }; // 2
  assert.equal(duoAvgKda({ aStats: a, bStats: b }), 2.5); // (3 + 2) / 2; pooled would be 34 / 12
});

test('duoAvgKda: a player with no deaths counts kills + assists', () => {
  const a = { kills: 4, assists: 1, deaths: 0, adr: 0, rwr: 0, roundsWon: 0, roundsPlayed: 0 }; // 5
  const b = { kills: 3, assists: 1, deaths: 2, adr: 0, rwr: 0, roundsWon: 0, roundsPlayed: 0 }; // 2
  assert.equal(duoAvgKda({ aStats: a, bStats: b }), 3.5);
});

report();
