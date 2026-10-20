/**
 * Coverage for the pure Gauntlet Preview model — clamping, seed names and the seed summary — built
 * on `buildGauntletBracket()`/`projectGauntletSeeding()`. No DB fixture needed.
 *
 * Run:  npx vitest run src/lib/gauntlet-preview.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { GAUNTLET_MAX_QUALIFIERS, GAUNTLET_MIN_QUALIFIERS, buildGauntletBracket, planToPreviewPods } from './gauntlet-bracket';
import { buildGauntletPreview, clampQualifierCount, qualifierCountFor, seedNamesFor, type PreviewStanding } from './gauntlet-preview';

const standings = (n: number): PreviewStanding[] => Array.from({ length: n }, (_, i) => ({ playerId: 100 + i, name: `P${i + 1}` }));

test('clampQualifierCount keeps counts inside the supported range', () => {
  assert.equal(clampQualifierCount(0), GAUNTLET_MIN_QUALIFIERS);
  assert.equal(clampQualifierCount(99), GAUNTLET_MAX_QUALIFIERS);
  assert.equal(clampQualifierCount(10), 10);
  assert.equal(qualifierCountFor(standings(3)), GAUNTLET_MIN_QUALIFIERS);
  assert.equal(qualifierCountFor(standings(25)), GAUNTLET_MAX_QUALIFIERS);
  assert.equal(qualifierCountFor(standings(11)), 11);
});

test('seedNamesFor names seeds in standings order and stops at the qualifier count', () => {
  const names = seedNamesFor(standings(8), 6);
  assert.deepEqual([...names.entries()], [[1, 'P1'], [2, 'P2'], [3, 'P3'], [4, 'P4'], [5, 'P5'], [6, 'P6']]);
  assert.equal(seedNamesFor(standings(3), 6).size, 3);
  assert.equal(seedNamesFor([], 6).size, 0);
});

test('every supported count builds a preview with one summary row per seed', () => {
  for (let n = GAUNTLET_MIN_QUALIFIERS; n <= GAUNTLET_MAX_QUALIFIERS; n++) {
    const preview = buildGauntletPreview(n);
    assert.equal(preview.seeds.length, n);
    assert.deepEqual(preview.seeds.map((s) => s.seed), Array.from({ length: n }, (_, i) => i + 1));
    assert.equal(preview.games, buildGauntletBracket(n).games);
    assert.equal(preview.pods.length, preview.plan.pods.length);
    assert.equal(preview.pods.filter((p) => p.is_final).length, 1);
    const relegated = preview.seeds.filter((s) => s.fate === 'relegated').map((s) => s.seed);
    assert.deepEqual(relegated, preview.plan.drops);
  }
});

test('the preview bracket is the plan rendered without names, equal to planToPreviewPods() in shape', () => {
  for (const n of [4, 8, 10, 12, 13, 20]) {
    const preview = buildGauntletPreview(n, standings(n));
    const reference = planToPreviewPods(buildGauntletBracket(n));
    assert.equal(preview.pods.length, reference.length);
    preview.pods.forEach((pod, i) => {
      assert.equal(pod.round_number, reference[i].round_number);
      assert.equal(pod.pod_index, reference[i].pod_index);
      assert.equal(pod.advance_rule, reference[i].advance_rule);
      assert.equal(pod.is_final, reference[i].is_final);
      assert.deepEqual(pod.slots.map((s) => s.source_seed), reference[i].slots.map((s) => s.source_seed));
      assert.ok(pod.slots.every((s) => s.player_name === null), 'names come from seedNames, not slots');
    });
  }
});

test('N=13: seed 1 has a bye to the final, seeds 2-13 play round 1, none relegated', () => {
  const { seeds } = buildGauntletPreview(13);
  assert.deepEqual(seeds[0], { seed: 1, name: null, fate: 'bye', entry: 'The Final' });
  assert.ok(seeds.slice(1).every((s) => s.fate === 'plays' && s.entry.startsWith('Round 1 Group ')));
});

test('N=16 relegates seeds 14-16; N=7 is a ladder with no byes until the final', () => {
  assert.deepEqual(buildGauntletPreview(16).seeds.filter((s) => s.fate === 'relegated').map((s) => s.seed), [14, 15, 16]);
  const ladder = buildGauntletPreview(7).seeds;
  assert.equal(ladder.filter((s) => s.fate === 'bye').length, 1);
  assert.equal(ladder[0].fate, 'bye');
  assert.equal(ladder[3].entry, 'Round 1 Group 1');
});

test('loaded standings name the summary rows; a short season leaves the rest unnamed', () => {
  const preview = buildGauntletPreview(10, standings(7));
  assert.equal(preview.seeds[0].name, 'P1');
  assert.equal(preview.seeds[6].name, 'P7');
  assert.equal(preview.seeds[7].name, null);
  assert.equal(preview.seedNames.get(3), 'P3');
});

test('an unsupported count throws rather than guessing a shape', () => {
  assert.throws(() => buildGauntletPreview(GAUNTLET_MAX_QUALIFIERS + 1));
});

report();
