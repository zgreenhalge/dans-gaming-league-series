/**
 * Regression harness for queries.ts's map functions (#63) — getAllMatchesWithPickBan, getMapIndex,
 * getMapDetail, getMapLookup, getMapsForWorkshopPicker, getMapCalibration, getMatchIdsForMap,
 * getAllPlayedMatchIds. (getMapHeatmap is excluded — it reads R2 directly, no Supabase involved,
 * out of scope for this harness.)
 *
 * getMatchIdsForMap()/getAllPlayedMatchIds() exercise fetchAllPages() across a real >1000-row
 * PostgREST page boundary via the fixture's pagination filler on the `matches` table.
 *
 * Run:  npx tsx src/lib/queries-maps.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import {
  getAllMatchesWithPickBan,
  getMapIndex,
  getMapDetail,
  getMapLookup,
  getMapsForWorkshopPicker,
  getMapCalibration,
  getMatchIdsForMap,
  getAllPlayedMatchIds,
} from './queries';

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
  await test('getAllMatchesWithPickBan() — only real, played matches with a pick, snapshot', async () => {
    const rows = await getAllMatchesWithPickBan();
    matchesSnapshot('getAllMatchesWithPickBan', rows);
  });

  await test('getMapIndex() — pick/ban counts across the league, snapshot', async () => {
    matchesSnapshot('getMapIndex', await getMapIndex());
  });

  await test('getMapDetail("foroglio") — played on twice (matches 100, 200), snapshot', async () => {
    const detail = await getMapDetail('foroglio');
    assert.notEqual(detail, null);
    matchesSnapshot('getMapDetail-foroglio', detail);
  });

  await test('getMapDetail("nonexistent-slug") — returns null', async () => {
    assert.equal(await getMapDetail('nonexistent-slug'), null);
  });

  await test('getMapLookup() — keyed by slug, snapshot', async () => {
    const lookup = await getMapLookup();
    assert.deepEqual(Object.keys(lookup).sort(), ['cobblestone', 'foroglio', 'vertigo']);
    matchesSnapshot('getMapLookup', lookup);
  });

  await test('getMapsForWorkshopPicker() — only maps with a resolvable workshop id, snapshot', async () => {
    const options = await getMapsForWorkshopPicker();
    // Cobblestone has no workshop_url in the fixture.
    assert.equal(options.some((o) => o.name === 'Cobblestone'), false);
    matchesSnapshot('getMapsForWorkshopPicker', options);
  });

  await test('getMapCalibration("foroglio") — fully calibrated, snapshot', async () => {
    matchesSnapshot('getMapCalibration-foroglio', await getMapCalibration('foroglio'));
  });

  await test('getMapCalibration("vertigo") — uncalibrated returns null', async () => {
    assert.equal(await getMapCalibration('vertigo'), null);
  });

  await test('getMatchIdsForMap("foroglio") — real matches + pagination filler resolve correctly', async () => {
    const ids = await getMatchIdsForMap('foroglio');
    // Real matches on Foroglio: 100 and 200 (both played, picked "Foroglio").
    assert.ok(ids.includes(100));
    assert.ok(ids.includes(200));
    // Filler matches use "Filler Map", not "Foroglio" — none should leak in here.
    assert.equal(ids.some((id) => id >= 90000), false);
  });

  await test('getMatchIdsForMap("Filler Map") — pagination genuinely crosses the 1000-row boundary', async () => {
    const ids = await getMatchIdsForMap('Filler Map');
    // 1250 filler matches, half with a real score (final_score alternates '13-9'/null) => 625 played.
    assert.equal(ids.length, 625);
  });

  await test('getAllPlayedMatchIds() — includes real played matches (100, 200, 300) and filler', async () => {
    const ids = await getAllPlayedMatchIds();
    assert.ok(ids.includes(100));
    assert.ok(ids.includes(200));
    assert.ok(ids.includes(300));
    assert.equal(ids.includes(101), false); // unplayed
    assert.equal(ids.includes(102), false); // S3-style "0-0"
    assert.equal(ids.length, 3 + 625);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('\nFailures:\n');
    for (const f of failures) console.error(`✗ ${f}\n`);
    process.exit(1);
  }
}

main();
