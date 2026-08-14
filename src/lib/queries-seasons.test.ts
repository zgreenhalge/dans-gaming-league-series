/**
 * Regression harness for queries.ts's season-core functions (#63) — getSeasons, getSeason,
 * getLinkedGauntlet, getLinkedRegularSeason. Golden-master snapshots against the shared fixture
 * (test-support/fixtures.ts) prove the eventual file split changes nothing.
 *
 * Run:  npx vitest run src/lib/queries-seasons.test.ts
 * Regenerate snapshots (only after reviewing a deliberate change):
 *   UPDATE_SNAPSHOTS=1 npx vitest run src/lib/queries-seasons.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getSeasons, getSeason, getLinkedGauntlet, getLinkedRegularSeason, getSeasonRoster, getActiveRegularSeason } from './queries';
import { test, report } from './test-support/miniTest';

async function main() {
  await test('getSeasons() snapshot', async () => {
    matchesSnapshot('getSeasons', await getSeasons());
  });

  await test('getSeason(1) — existing regular season, snapshot', async () => {
    matchesSnapshot('getSeason-1', await getSeason(1));
  });

  await test('getSeason(2) — existing gauntlet season, snapshot', async () => {
    matchesSnapshot('getSeason-2', await getSeason(2));
  });

  await test('getSeason(9999) — nonexistent id returns null', async () => {
    assert.equal(await getSeason(9999), null);
  });

  await test('getLinkedGauntlet("Season 5") — paired gauntlet found, snapshot', async () => {
    matchesSnapshot('getLinkedGauntlet-Season5', await getLinkedGauntlet('Season 5'));
  });

  await test('getLinkedGauntlet("Season 6") — no paired gauntlet returns null', async () => {
    assert.equal(await getLinkedGauntlet('Season 6'), null);
  });

  await test('getLinkedRegularSeason("Season 5 Gauntlet") — paired regular season found, snapshot', async () => {
    matchesSnapshot('getLinkedRegularSeason-Season5Gauntlet', await getLinkedRegularSeason('Season 5 Gauntlet'));
  });

  await test('getLinkedRegularSeason("Season 4 Gauntlet") — orphan gauntlet returns null', async () => {
    assert.equal(await getLinkedRegularSeason('Season 4 Gauntlet'), null);
  });

  await test('getSeasonRoster(3) — season with a roster, snapshot', async () => {
    matchesSnapshot('getSeasonRoster-3', await getSeasonRoster(3));
  });

  await test('getSeasonRoster(1) — orphan row (player_id missing from playersById) is skipped', async () => {
    assert.deepEqual(await getSeasonRoster(1), []);
  });

  await test('getActiveRegularSeason() — the fixture\'s one ACTIVE non-gauntlet season', async () => {
    const season = await getActiveRegularSeason();
    assert.equal(season?.id, 3);
    assert.equal(season?.is_gauntlet, false);
    assert.equal(season?.status, 'ACTIVE');
  });

  report();
}

await main();
