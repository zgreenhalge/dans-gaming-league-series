/**
 * Unit tests for the map/pick-ban aggregators. `aggregateMapPickBanStats` is the one flagged as a
 * domain-edge-case magnet: map names are user-typed (case/whitespace bucketing), the "effective map"
 * falls back between shirts_pick and picked_map depending on who picked, and unplayed ("0-0"
 * pre-staged) matches must be excluded. `aggregateScoreDistribution`'s margin buckets are also
 * boundary-prone, so those get a couple of cases too.
 *
 * Run:  npx tsx src/lib/mapSideStats.test.ts
 */

import assert from 'node:assert/strict';
import {
  aggregateMapPickBanStats,
  aggregateScoreDistribution,
  classifyMatchVeto,
  aggregatePlayerMapStats,
  type MatchPickBanInput,
  type PlayerMatchInput,
} from './mapSideStats';

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

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
