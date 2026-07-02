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
  type MatchPickBanInput,
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

test('aggregateScoreDistribution: margin buckets (close/comfortable/landslide) and OT', () => {
  const matches = [
    match({ final_score: '13-12' }), // margin 1 -> close
    match({ final_score: '13-9' }), // margin 4 -> comfortable
    match({ final_score: '13-2' }), // margin 11 -> landslide
    match({ final_score: '16-14' }), // winner > 13 -> OT (checked before margin)
    match({ final_score: '0-0' }), // unplayed -> excluded
  ];
  const out = aggregateScoreDistribution(matches);
  assert.equal(out.total, 4);
  assert.equal(out.close, 1);
  assert.equal(out.comfortable, 1);
  assert.equal(out.landslide, 1);
  assert.equal(out.ot, 1);
});

test('aggregateScoreDistribution: margin exactly 2 is close, exactly 3 is comfortable (boundary)', () => {
  const out = aggregateScoreDistribution([match({ final_score: '13-11' }), match({ final_score: '13-10' })]);
  assert.equal(out.close, 1);
  assert.equal(out.comfortable, 1);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
