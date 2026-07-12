/**
 * Regression harness for queries.ts's season-core functions (#63) — getSeasons, getSeason,
 * getLinkedGauntlet, getLinkedRegularSeason. Golden-master snapshots against the shared fixture
 * (test-support/fixtures.ts) prove the eventual file split changes nothing.
 *
 * Run:  npx tsx src/lib/queries-seasons.test.ts
 * Regenerate snapshots (only after reviewing a deliberate change):
 *   UPDATE_SNAPSHOTS=1 npx tsx src/lib/queries-seasons.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getSeasons, getSeason, getLinkedGauntlet, getLinkedRegularSeason } from './queries';

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      passed++;
    } catch (err) {
      failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
    }
  })();
}

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

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('\nFailures:\n');
    for (const f of failures) console.error(`✗ ${f}\n`);
    process.exit(1);
  }
}

main();
