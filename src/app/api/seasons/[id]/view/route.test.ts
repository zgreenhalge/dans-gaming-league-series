/**
 * Route-handler harness for GET /api/seasons/[id]/view — exercises the route's own query-param
 * validation (`kind`/`seasonNumber`) and its dispatch to getRegularSeasonLightView()/
 * getGauntletSeasonLightView(), through the exported handler directly. The underlying light-view
 * functions' own data correctness is covered by queries-seasons.test.ts/queries-gauntlet.test.ts —
 * this only checks that the route wires them up correctly.
 *
 * Uses the shared "league" fixture (test-support/fixtures.ts) rather than a route-local FakeDb,
 * since this route (like the queries/*.ts functions it calls) is read-only.
 *
 * Run:  npx vitest run "src/app/api/seasons/[id]/view/route.test.ts"
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
  return GET(jsonRequest(`http://localhost/api/seasons/${seasonId}/view${query}`, 'GET'), {
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

  await test('rejects a non-numeric seasonNumber', async () => {
    const res = await call(REGULAR_SEASON_ID, '?kind=regular&seasonNumber=abc');
    assert.equal(res.status, 400);
  });

  await test('kind=regular returns the regular season light view', async () => {
    const res = await call(REGULAR_SEASON_ID, '?kind=regular&seasonNumber=5');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.schedule) && body.schedule.length > 0);
    assert.ok(body.h2hData);
    assert.equal(typeof body.hasAdvancedStats, 'boolean');
    // Gauntlet-only fields must not be present on the regular shape.
    assert.equal(body.rounds, undefined);
    assert.equal(body.leaderboard, undefined);
    // Stats-view fields belong to GET /api/seasons/[id]/stats, not this route.
    assert.equal(body.sabremetrics, undefined);
  });

  await test('kind=gauntlet returns the gauntlet season light view, leaderboard derived from rounds', async () => {
    const res = await call(GAUNTLET_SEASON_ID, '?kind=gauntlet&seasonNumber=5');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.rounds) && body.rounds.length > 0);
    assert.ok(Array.isArray(body.leaderboard) && body.leaderboard.length > 0);
    assert.ok(body.h2hData);
    assert.equal(typeof body.hasAdvancedStats, 'boolean');
    // Regular-only field must not be present on the gauntlet shape.
    assert.equal(body.schedule, undefined);
  });

  await test('omitted seasonNumber is accepted (h2h just resolves without a season number to key by)', async () => {
    const res = await call(REGULAR_SEASON_ID, '?kind=regular');
    assert.equal(res.status, 200);
  });

  report();
}

await main();
