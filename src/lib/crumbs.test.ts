/**
 * Regression tests for `buildCrumbs` and the route helpers (crumbs.ts). Run:
 *   npx vitest run src/lib/crumbs.test.ts
 */

import assert from 'node:assert/strict';
import { buildCrumbs, groupHref, groupLabel, roundHref, weekHref, gauntletHref } from './crumbs';
import { test } from './test-support/miniTest';

const season = { id: 5, name: 'Season 5' };

test('buildCrumbs: a season page ends at the season, unlinked', () => {
  assert.deepEqual(buildCrumbs({ season }), [
    { label: 'DGLS', href: '/' },
    { label: 'Seasons', href: '/seasons' },
    { label: 'Season 5' },
  ]);
});

test('buildCrumbs: a regular match links through season and week', () => {
  assert.deepEqual(buildCrumbs({ season, week: { id: 31, number: 3 }, leaf: 'Match 2' }), [
    { label: 'DGLS', href: '/' },
    { label: 'Seasons', href: '/seasons' },
    { label: 'Season 5', href: '/seasons/5' },
    { label: 'Week 3', href: '/seasons/5/weeks/31' },
    { label: 'Match 2' },
  ]);
});

test('buildCrumbs: a gauntlet game links through gauntlet, round and group', () => {
  const crumbs = buildCrumbs({
    season,
    gauntlet: true,
    week: { id: 90, number: 2 },
    group: { id: 14, podIndex: 0, isFinal: false },
    leaf: 'Game 2',
  });
  assert.deepEqual(
    crumbs.map((c) => [c.label, c.href]),
    [
      ['DGLS', '/'],
      ['Seasons', '/seasons'],
      ['Season 5', '/seasons/5'],
      ['Gauntlet', '/seasons/5?view=gauntlet'],
      ['Round 2', '/seasons/5/rounds/90'],
      ['Group 1', '/seasons/5/groups/14'],
      ['Game 2', undefined],
    ],
  );
});

test('buildCrumbs: the last crumb is never a link, whichever level it is', () => {
  const week = buildCrumbs({ season, week: { id: 31, number: 3 } });
  assert.equal(week.at(-1)?.href, undefined);
  const group = buildCrumbs({ season, gauntlet: true, week: { id: 90, number: 4 }, group: { id: 20, podIndex: 0, isFinal: true } });
  assert.deepEqual(group.at(-1), { label: 'Final' });
});

test('groupLabel: 1-indexed, with Final for the final pod', () => {
  assert.equal(groupLabel(0, false), 'Group 1');
  assert.equal(groupLabel(3, false), 'Group 4');
  assert.equal(groupLabel(0, true), 'Final');
});

test('route helpers assemble the readable paths with real ids', () => {
  assert.equal(weekHref(5, 31), '/seasons/5/weeks/31');
  assert.equal(roundHref(5, 90), '/seasons/5/rounds/90');
  assert.equal(groupHref(5, 14), '/seasons/5/groups/14');
  assert.equal(gauntletHref(5), '/seasons/5?view=gauntlet');
});

test('buildCrumbs: a round with no week row yet links to the gauntlet view', () => {
  const crumbs = buildCrumbs({
    season,
    gauntlet: true,
    week: { id: null, number: 3 },
    group: { id: 20, podIndex: 0, isFinal: true },
  });
  assert.equal(crumbs.find((c) => c.label === 'Round 3')?.href, '/seasons/5?view=gauntlet');
});
