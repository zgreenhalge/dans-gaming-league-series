/**
 * Regression tests for `buildCrumbs` and the route helpers (crumbs.ts). Run:
 *   npx vitest run src/lib/crumbs.test.ts
 */

import assert from 'node:assert/strict';
import {
  buildCrumbs,
  careerH2HHref,
  gauntletHref,
  gauntletLink,
  groupHref,
  groupName,
  h2hPairHref,
  regularSeasonLink,
  roundHref,
  seasonScheduleHref,
  gauntletScheduleHref,
  stageHeading,
  weekHref,
} from './crumbs';
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
    round: 2,
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
      ['Round 2', '/seasons/5/rounds/2'],
      ['Group 1', '/seasons/5/groups/14'],
      ['Game 2', undefined],
    ],
  );
});

test('buildCrumbs: the last crumb is never a link, whichever level it is', () => {
  const week = buildCrumbs({ season, week: { id: 31, number: 3 } });
  assert.equal(week.at(-1)?.href, undefined);
  const group = buildCrumbs({ season, gauntlet: true, round: 4, group: { id: 20, podIndex: 0, isFinal: true } });
  assert.deepEqual(group.at(-1), { label: 'Final' });
});

test('groupName: 1-indexed, with Final for the final pod', () => {
  assert.equal(groupName(0, false), 'Group 1');
  assert.equal(groupName(3, false), 'Group 4');
  assert.equal(groupName(0, true), 'Final');
});

test('route helpers assemble the readable paths with real ids', () => {
  assert.equal(weekHref(5, 31), '/seasons/5/weeks/31');
  assert.equal(roundHref(5, 2), '/seasons/5/rounds/2');
  assert.equal(groupHref(5, 14), '/seasons/5/groups/14');
  assert.equal(gauntletHref(5), '/seasons/5?view=gauntlet');
});

test('stageHeading: a week names the season, linking to its Schedule tab at that week', () => {
  assert.deepEqual(stageHeading({ season, week: { id: 31, number: 3 } }), {
    parent: { label: 'Season 5', href: '/seasons/5?tab=schedule&week=31' },
    title: [{ label: 'Week 3' }],
  });
});

test('stageHeading: a round or group sits under the season gauntlet; a group links its round', () => {
  const parent = { label: 'Season 5 Gauntlet', href: '/seasons/5?view=gauntlet' };
  assert.deepEqual(stageHeading({ season, gauntlet: true, round: 2 }), { parent, title: [{ label: 'Round 2' }] });
  assert.deepEqual(stageHeading({ season, gauntlet: true, round: 2, group: { id: 14, podIndex: 0, isFinal: false } }), {
    parent,
    title: [{ label: 'Round 2', href: '/seasons/5/rounds/2' }, { label: 'Group 1' }],
  });
});

test('stageHeading: the title levels are the same labels buildCrumbs() ends its trail with', () => {
  const trail = { season, gauntlet: true, round: 2, group: { id: 14, podIndex: 3, isFinal: true } };
  const crumbs = buildCrumbs(trail).map((c) => c.label);
  assert.deepEqual(stageHeading(trail).title.map((c) => c.label), crumbs.slice(-2));
});

test('regularSeasonLink: a back link from a gauntlet page, none when the hub is itself a gauntlet', () => {
  assert.deepEqual(regularSeasonLink({ id: 5, is_gauntlet: false }), { label: '← Regular season', href: '/seasons/5', direction: 'back' });
  assert.equal(regularSeasonLink({ id: 9, is_gauntlet: true }), undefined);
});

test('gauntletLink: a forward link to the first round, none without one', () => {
  assert.deepEqual(gauntletLink(5, 1), { label: 'Gauntlet →', href: '/seasons/5/rounds/1', direction: 'forward' });
  assert.equal(gauntletLink(5, null), undefined);
});

test('seasonScheduleHref / gauntletScheduleHref: the hub\'s Schedule tab, in the regular or gauntlet view', () => {
  assert.equal(seasonScheduleHref(5), '/seasons/5?tab=schedule');
  assert.equal(gauntletScheduleHref(5), '/seasons/5?view=gauntlet&tab=schedule');
});

test('h2hPairHref: names in a, b; type only for opponents (partner is the default)', () => {
  assert.equal(h2hPairHref('/statistics', 'Sean', 'Eric', 'partner'), '/statistics?tab=h2h&a=Sean&b=Eric');
  assert.equal(h2hPairHref('/seasons/3', 'Grach', 'Sean', 'opponent'), '/seasons/3?tab=h2h&a=Grach&b=Sean&type=opponent');
});

test('h2hPairHref: names are URL-encoded', () => {
  assert.equal(h2hPairHref('/statistics', 'A & B', 'C D', 'partner'), '/statistics?tab=h2h&a=A+%26+B&b=C+D');
});

test('careerH2HHref: the Statistics page\'s H2H tab', () => {
  assert.equal(careerH2HHref(), '/statistics?tab=h2h');
});
