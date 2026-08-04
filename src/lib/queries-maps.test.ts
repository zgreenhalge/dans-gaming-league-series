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
import { test, report } from './test-support/miniTest';
import { deriveRates } from './util';
import type { LeaderboardRowWithId } from './types';

const fakeDb = buildFakeDb();
__setTestClient(createFakeSupabaseClient(fakeDb));

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

/** Guards against a duplicate inline reimplementation of `deriveRates()` silently reappearing. */
function assertRatesMatchDeriveRates(rows: LeaderboardRowWithId[], label: string) {
  for (const r of rows) {
    const rates = deriveRates(r);
    assert.equal(r.win_rate_percentage, rates.win_rate_percentage, `${label}: ${r.player_name} win_rate_percentage`);
    assert.equal(r.kd_ratio, rates.kd_ratio, `${label}: ${r.player_name} kd_ratio`);
    assert.equal(r.rwr_percentage, rates.rwr_percentage, `${label}: ${r.player_name} rwr_percentage`);
    assert.equal(r.overall_adr, rates.overall_adr, `${label}: ${r.player_name} overall_adr`);
  }
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
    assertRatesMatchDeriveRates(detail!.playerStats, 'getMapDetail("foroglio").playerStats');
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

  await test('getMatchIdsForMap("foroglio", explicitClient) — an explicitly passed client (the shape the replay-extract Action uses) gives the same result as the default', async () => {
    const explicitClient = createFakeSupabaseClient(fakeDb);
    const ids = await getMatchIdsForMap('foroglio', explicitClient);
    assert.deepEqual(ids.sort(), (await getMatchIdsForMap('foroglio')).sort());
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

  report();
}

main();
