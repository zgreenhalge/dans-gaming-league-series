/**
 * Unit tests for the map/pick-ban aggregators. `aggregateMapPickBanStats` is the one flagged as a
 * domain-edge-case magnet: map names are user-typed (case/whitespace bucketing), the "effective map"
 * falls back between shirts_pick and picked_map depending on who picked, and unplayed ("0-0"
 * pre-staged) matches must be excluded. `aggregateScoreDistribution`'s margin buckets are also
 * boundary-prone, so those get a couple of cases too.
 *
 * Run:  npx vitest run src/lib/mapSideStats.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import {
  aggregateMapPickBanStats,
  aggregateScoreDistribution,
  classifyMatchVeto,
  aggregatePlayerMapStats,
  aggregateMapIndexStats,
  type MatchPickBanInput,
  type PlayerMatchInput,
} from './mapSideStats';
import type { MapIndexEntry, MapSeasonStat } from './types';

function match(opts: Partial<MatchPickBanInput>): MatchPickBanInput {
  return {
    final_score: '13-9',
    picked_map: null,
    shirts_pick: null,
    skins_starting_side: null,
    shirts_stats: [],
    skins_stats: [],
    ...opts,
  };
}

test('aggregateMapPickBanStats: map names bucket case-insensitively and trim whitespace', () => {
  const matches = [
    match({ shirts_pick: 'Palais' }),
    match({ shirts_pick: '  palais  ' }),
    match({ shirts_pick: 'PALAIS' }),
  ];
  const out = aggregateMapPickBanStats(matches);
  assert.equal(out.length, 1);
  assert.equal(out[0].picked, 3);
});

test('aggregateMapPickBanStats: effective map falls back to picked_map when shirts_pick is unset', () => {
  const matches = [match({ shirts_pick: null, picked_map: 'Nuke' })];
  const out = aggregateMapPickBanStats(matches);
  assert.equal(out[0].map, 'Nuke');
});

test('aggregateMapPickBanStats: shirts_pick wins over picked_map when both are present', () => {
  // shirts_pick is the effective map even if picked_map (skins' pick, e.g. for a different map/round) differs
  const matches = [match({ shirts_pick: 'Train Yard', picked_map: 'Nuke' })];
  const out = aggregateMapPickBanStats(matches);
  assert.equal(out[0].map, 'Train Yard');
});

test('aggregateMapPickBanStats: unplayed ("0-0" pre-staged) matches are excluded', () => {
  const matches = [
    match({ shirts_pick: 'Palais', final_score: '0-0' }),
    match({ shirts_pick: 'Palais', final_score: null }),
  ];
  assert.equal(aggregateMapPickBanStats(matches).length, 0);
});

test('aggregateMapPickBanStats: a match with no effective map at all is excluded', () => {
  const matches = [match({ shirts_pick: null, picked_map: null })];
  assert.equal(aggregateMapPickBanStats(matches).length, 0);
});

test('aggregateMapPickBanStats: pickedAndWon credits the team that picked, not whoever won', () => {
  const shirtsWon = match({
    shirts_pick: 'Palais',
    shirts_stats: [{ is_win: true }],
    skins_stats: [{ is_win: false }],
  });
  const skinsWonButShirtsPicked = match({
    shirts_pick: 'Palais',
    shirts_stats: [{ is_win: false }],
    skins_stats: [{ is_win: true }],
  });
  const out = aggregateMapPickBanStats([shirtsWon, skinsWonButShirtsPicked]);
  assert.equal(out[0].picked, 2);
  assert.equal(out[0].pickedAndWon, 1); // only the match where the picker (shirts) actually won
});

test('aggregateMapPickBanStats: results sort by picked count descending', () => {
  const matches = [
    match({ shirts_pick: 'A' }),
    match({ shirts_pick: 'B' }),
    match({ shirts_pick: 'B' }),
  ];
  const out = aggregateMapPickBanStats(matches);
  assert.equal(out[0].map, 'B');
  assert.equal(out[0].picked, 2);
});

test('aggregateMapPickBanStats: avgRounds averages total match rounds (shirts + skins) across picks', () => {
  const matches = [
    match({ shirts_pick: 'Palais', final_score: '13-9' }), // 22 rounds
    match({ shirts_pick: 'Palais', final_score: '16-14' }), // 30 rounds
  ];
  const out = aggregateMapPickBanStats(matches);
  assert.equal(out[0].avgRounds, 26); // (22 + 30) / 2
});

test('aggregateMapPickBanStats: a map that is only ever banned (never picked) still gets a row', () => {
  const matches = [match({ shirts_pick: 'Palais', shirts_ban: 'Vertigo' })];
  const out = aggregateMapPickBanStats(matches);
  const vertigo = out.find((m) => m.map === 'Vertigo');
  assert.ok(vertigo);
  assert.equal(vertigo!.picked, 0);
  assert.equal(vertigo!.banned, 1);
});

test('aggregateMapPickBanStats: no-pick — a pool map untouched by veto in a played, non-playoff match', () => {
  const matches = [
    match({
      shirts_pick: 'Palais',
      shirts_ban: 'Vertigo',
      map_pool: ['Palais', 'Vertigo', 'Nuke'],
    }),
  ];
  const out = aggregateMapPickBanStats(matches);
  const nuke = out.find((m) => m.map === 'Nuke');
  assert.ok(nuke);
  assert.equal(nuke!.noPicked, 1);
  assert.equal(nuke!.picked, 0);
  assert.equal(nuke!.banned, 0);
});

test('classifyMatchVeto: no-pick is suppressed for playoff matches and matches without a map_pool', () => {
  const playoff = classifyMatchVeto({
    final_score: '13-9', picked_map: 'Palais', shirts_pick: null,
    is_playoff_game: true, map_pool: ['Palais', 'Nuke'],
  });
  assert.deepEqual(playoff.noPicked, []);

  const noPool = classifyMatchVeto({
    final_score: '13-9', picked_map: 'Palais', shirts_pick: null,
    is_playoff_game: false, map_pool: null,
  });
  assert.deepEqual(noPool.noPicked, []);
});

test('classifyMatchVeto: an unplayed match classifies as empty even with bans/pool set', () => {
  const out = classifyMatchVeto({
    final_score: null, picked_map: 'Palais', shirts_pick: null,
    shirts_ban: 'Vertigo', is_playoff_game: false, map_pool: ['Palais', 'Vertigo', 'Nuke'],
  });
  assert.deepEqual(out, { picked: [], banned: [], noPicked: [] });
});

function playerMatch(opts: Partial<PlayerMatchInput>): PlayerMatchInput {
  return {
    match_id: 0,
    final_score: '13-9',
    map: null,
    faction: 'SHIRTS',
    skins_starting_side: null,
    shirts_pick: null,
    picked_map: null,
    is_win: false,
    rounds_won: 0,
    rounds_played: 0,
    ...opts,
  };
}

test('aggregatePlayerMapStats: banned/no-picked are counted from the match veto, independent of whether the player played that map', () => {
  const matches = [
    playerMatch({
      map: 'Palais', shirts_pick: 'Palais', faction: 'SHIRTS',
      shirts_ban2: 'Vertigo', map_pool: ['Palais', 'Vertigo', 'Nuke'],
    }),
  ];
  const out = aggregatePlayerMapStats(matches);
  const vertigo = out.find((m) => m.map === 'Vertigo');
  const nuke = out.find((m) => m.map === 'Nuke');
  assert.ok(vertigo);
  assert.equal(vertigo!.banned, 1);
  assert.equal(vertigo!.games, 0);
  assert.ok(nuke);
  assert.equal(nuke!.noPicked, 1);
  assert.equal(nuke!.games, 0);
});

test('aggregatePlayerMapStats: avgRounds averages the player\'s own rounds_played across games on that map', () => {
  const matches = [
    playerMatch({ map: 'Palais', rounds_played: 22 }),
    playerMatch({ map: 'Palais', rounds_played: 16 }),
  ];
  const out = aggregatePlayerMapStats(matches);
  const palais = out.find((m) => m.map === 'Palais');
  assert.ok(palais);
  assert.equal(palais!.avgRounds, 19); // (22 + 16) / 2
});

test('aggregateScoreDistribution: loser-round buckets (crushed/convincing/competitive/close) and CRAZY', () => {
  const matches = [
    match({ final_score: '13-11' }), // loser 11 -> close
    match({ final_score: '13-8' }), // loser 8 -> competitive
    match({ final_score: '13-5' }), // loser 5 -> convincing
    match({ final_score: '13-2' }), // loser 2 -> crushed
    match({ final_score: '16-14' }), // winner > 13 -> CRAZY (checked before loser buckets)
    match({ final_score: '0-0' }), // unplayed -> excluded
  ];
  const out = aggregateScoreDistribution(matches);
  assert.equal(out.total, 5);
  assert.equal(out.crushed, 1);
  assert.equal(out.convincing, 1);
  assert.equal(out.competitive, 1);
  assert.equal(out.close, 1);
  assert.equal(out.crazy, 1);
});

test('aggregateScoreDistribution: loser-round bucket boundaries', () => {
  const out = aggregateScoreDistribution([
    match({ final_score: '13-3' }), // loser 3 -> crushed
    match({ final_score: '13-4' }), // loser 4 -> convincing
    match({ final_score: '13-6' }), // loser 6 -> convincing
    match({ final_score: '13-7' }), // loser 7 -> competitive
    match({ final_score: '13-9' }), // loser 9 -> competitive
    match({ final_score: '13-10' }), // loser 10 -> close
  ]);
  assert.equal(out.crushed, 1);
  assert.equal(out.convincing, 2);
  assert.equal(out.competitive, 2);
  assert.equal(out.close, 1);
});

function seasonStat(opts: Partial<MapSeasonStat>): MapSeasonStat {
  return {
    seasonId: 1,
    isGauntlet: false,
    pickCount: 0,
    banCount: 0,
    noPickCount: 0,
    totalKills: 0,
    totalAssists: 0,
    totalRounds: 0,
    pickAndWon: 0,
    ...opts,
  };
}

function mapIndexEntry(opts: Partial<MapIndexEntry>): MapIndexEntry {
  return {
    name: 'Palais',
    slug: 'palais',
    pickCount: 0,
    banCount: 0,
    noPickCount: 0,
    seasons: [{ id: 1, name: 'Season 1', is_gauntlet: false }],
    statsBySeason: [],
    ...opts,
  };
}

const allIn = { includeRegular: true, includeGauntlet: true, selectedSeason: 'all' as const };

test('aggregateMapIndexStats: sums a map\'s per-season stats and derives avgRounds from totalRounds/pickCount', () => {
  const maps = [
    mapIndexEntry({
      slug: 'palais',
      statsBySeason: [
        seasonStat({ seasonId: 1, pickCount: 2, totalRounds: 44, totalKills: 100, totalAssists: 20, banCount: 1, noPickCount: 0, pickAndWon: 1 }),
        seasonStat({ seasonId: 2, pickCount: 1, totalRounds: 20, totalKills: 40, totalAssists: 8, banCount: 0, noPickCount: 1, pickAndWon: 0 }),
      ],
    }),
  ];
  const out = aggregateMapIndexStats(maps, allIn);
  const palais = out.get('palais');
  assert.ok(palais);
  assert.equal(palais!.pickCount, 3);
  assert.equal(palais!.banCount, 1);
  assert.equal(palais!.noPickCount, 1);
  assert.equal(palais!.pickAndWon, 1);
  assert.equal(palais!.totalKills, 140);
  assert.equal(palais!.totalAssists, 28);
  assert.equal(palais!.avgRounds, 64 / 3); // (44 + 20) / (2 + 1)
});

test('aggregateMapIndexStats: a map with zero picks in scope has avgRounds 0, not NaN', () => {
  const maps = [mapIndexEntry({ slug: 'nuke', statsBySeason: [] })];
  const out = aggregateMapIndexStats(maps, allIn);
  assert.equal(out.get('nuke')!.avgRounds, 0);
});

test('aggregateMapIndexStats: includeGauntlet=false excludes gauntlet-season stats from the totals', () => {
  const maps = [
    mapIndexEntry({
      slug: 'palais',
      statsBySeason: [
        seasonStat({ seasonId: 1, isGauntlet: false, pickCount: 2 }),
        seasonStat({ seasonId: 2, isGauntlet: true, pickCount: 5 }),
      ],
    }),
  ];
  const out = aggregateMapIndexStats(maps, { includeRegular: true, includeGauntlet: false, selectedSeason: 'all' });
  assert.equal(out.get('palais')!.pickCount, 2);
});

test('aggregateMapIndexStats: selectedSeason narrows to a single season regardless of the regular/gauntlet toggles', () => {
  const maps = [
    mapIndexEntry({
      slug: 'palais',
      statsBySeason: [
        seasonStat({ seasonId: 1, pickCount: 2 }),
        seasonStat({ seasonId: 2, pickCount: 5 }),
      ],
    }),
  ];
  const out = aggregateMapIndexStats(maps, { includeRegular: true, includeGauntlet: true, selectedSeason: 2 });
  assert.equal(out.get('palais')!.pickCount, 5);
});

test('aggregateMapIndexStats: seasonsPlayed counts distinct regular-season numbers in the pool, unaffected by the season filter', () => {
  const maps = [
    mapIndexEntry({
      slug: 'palais',
      seasons: [
        { id: 1, name: 'Season 1', is_gauntlet: false },
        { id: 2, name: 'Season 1 Gauntlet', is_gauntlet: true },
        { id: 3, name: 'Season 2', is_gauntlet: false },
      ],
      statsBySeason: [],
    }),
  ];
  const out = aggregateMapIndexStats(maps, { includeRegular: false, includeGauntlet: false, selectedSeason: 'all' });
  assert.equal(out.get('palais')!.seasonsPlayed, 2); // Season 1 and Season 2 (gauntlet excluded, filter ignored)
});

report();
