/**
 * Regression tests for `computeH2H` (util.ts) — the shared duo/rival aggregation
 * core behind the H2H tab. Written before refactoring `getH2HData` (queries.ts)
 * to delegate to this function, and before wiring the client-side call sites
 * (CareerStatsView, MapDetailView) added by issue #84, to lock in the existing
 * behavior first.
 *
 * No test framework — just `node:assert` and a tiny runner (mirrors util.test.ts):
 *   npx tsx src/lib/h2h.test.ts
 */

import assert from 'node:assert/strict';
import { computeH2H, mapMatchRowsToH2HInput, type H2HMatchInput, type H2HRosterRow } from './util';

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
      picked_map: null,
      shirts_pick: 'de_overpass',
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
  assert.equal(inputs[0].map, 'de_overpass', 'falls back to shirts_pick when picked_map is null');
  assert.equal(inputs[0].roster.length, 4);

  const result = computeH2H(inputs, players);
  assert.equal(result.duos.length, 2);
  assert.equal(result.rivals.length, 4);
  const duo = result.duos.find((d) => d.playerA === 1 && d.playerB === 2)!;
  assert.equal(duo.bestMap, 'de_overpass');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error('\nFailures:\n');
  for (const f of failures) console.error(`✗ ${f}\n`);
  process.exit(1);
}
