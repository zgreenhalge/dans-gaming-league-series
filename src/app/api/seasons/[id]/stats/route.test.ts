/**
 * Route-handler harness for GET /api/seasons/[id]/stats — exercises the route's own query-param
 * validation (`kind`) and its dispatch to getRegularSeasonStatsView()/getGauntletSeasonStatsView(),
 * through the exported handler directly. The underlying stats-view functions' own data correctness
 * is covered by queries-seasons.test.ts/queries-gauntlet.test.ts — this only checks that the route
 * wires them up correctly.
 *
 * Uses the shared "league" fixture (test-support/fixtures.ts) rather than a route-local FakeDb,
 * since this route (like the queries/*.ts functions it calls) is read-only.
 *
 * Run:  npx vitest run "src/app/api/seasons/[id]/stats/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestClient } from '@/lib/supabase';
import { createFakeSupabaseClient } from '@/lib/test-support/fakeSupabase';
import { buildFakeDb } from '@/lib/test-support/fixtures';
import { jsonRequest } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { GET } from './route';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

const REGULAR_SEASON_ID = 1; // "Season 5"
const GAUNTLET_SEASON_ID = 2; // "Season 5 Gauntlet"

function call(seasonId: number, query: string) {
  return GET(jsonRequest(`http://localhost/api/seasons/${seasonId}/stats${query}`, 'GET'), {
    params: Promise.resolve({ id: String(seasonId) }),
  });
}

async function main() {
  await test('rejects a non-numeric season id', async () => {
    const res = await call(NaN, '?kind=regular');
    assert.equal(res.status, 400);
  });

  await test('rejects a missing/invalid kind', async () => {
    const res = await call(REGULAR_SEASON_ID, '');
    assert.equal(res.status, 400);
    const resBad = await call(REGULAR_SEASON_ID, '?kind=bogus');
    assert.equal(resBad.status, 400);
  });

  await test('kind=regular returns the regular season stats view', async () => {
    const res = await call(REGULAR_SEASON_ID, '?kind=regular');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.sabremetrics));
    assert.ok(Array.isArray(body.matchRounds));
    assert.ok(Array.isArray(body.matchKills));
    assert.ok(Array.isArray(body.matchWeaponClassStats));
    assert.ok(Array.isArray(body.matchEconomyStats));
    // Light-view-only fields must not be present on the stats shape.
    assert.equal(body.schedule, undefined);
    assert.equal(body.hasAdvancedStats, undefined);
  });

  await test('kind=gauntlet returns the gauntlet season stats view', async () => {
    const res = await call(GAUNTLET_SEASON_ID, '?kind=gauntlet');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.sabremetrics));
    assert.ok(Array.isArray(body.matchRounds));
    // Light-view-only fields must not be present on the stats shape.
    assert.equal(body.rounds, undefined);
    assert.equal(body.leaderboard, undefined);
  });

  report();
}

await main();
