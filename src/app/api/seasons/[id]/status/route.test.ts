/**
 * Route-handler harness for PATCH /api/seasons/[id]/status (#379) — exercises requireAdminAccess()'s
 * 401/403 branches and activateSeason()'s status transition + best-effort gauntlet-build side
 * effect, through the exported handler directly, using the same `jsonRequest()`/`__setTestSession()`/
 * `__setTestClient()`/`__setTestAdminClient()` harness `seasons/[id]/players/route.test.ts` (#319)
 * established.
 *
 * Run:  npx tsx src/app/api/seasons/[id]/status/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestClient } from '@/lib/supabase';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { PATCH } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const UPCOMING_SEASON_ID = 10;
const GAUNTLET_SEASON_ID = 11;
const ACTIVE_SEASON_ID = 12;
const UPCOMING_NO_LEADERBOARD_ID = 13;

function makeDb(): FakeDb {
  return {
    players: [
      { id: ADMIN_ID, is_admin: true },
      { id: PLAYER_ID, is_admin: false },
    ],
    seasons: [
      { id: UPCOMING_SEASON_ID, name: 'Season 9', status: 'UPCOMING', is_gauntlet: false, target_win_rounds: 13 },
      // A distinct season number from UPCOMING_SEASON_ID's "Season 9" — this row exists purely to
      // exercise the "season itself is a gauntlet" 404 branch, and must not collide with the
      // "Season 9 Gauntlet" name activateSeason() derives and creates for UPCOMING_SEASON_ID below.
      { id: GAUNTLET_SEASON_ID, name: 'Season 77 Gauntlet', status: 'UPCOMING', is_gauntlet: true, target_win_rounds: 13 },
      { id: ACTIVE_SEASON_ID, name: 'Season 8', status: 'ACTIVE', is_gauntlet: false, target_win_rounds: 13 },
      { id: UPCOMING_NO_LEADERBOARD_ID, name: 'Season 10', status: 'UPCOMING', is_gauntlet: false, target_win_rounds: 13 },
    ],
    player_season_leaderboard: [1, 2, 3, 4].map((id, i) => ({
      season_id: UPCOMING_SEASON_ID, player_id: id, player_name: `Player ${id}`, win_rate_percentage: 100 - i * 10,
    })),
    gauntlet_pods: [],
    gauntlet_pod_slots: [],
    ops_errors: [],
  };
}

function installFixture(): FakeDb {
  const db = makeDb();
  const client = createFakeSupabaseClient(db);
  __setTestClient(client);
  __setTestAdminClient(client);
  return db;
}

const url = (seasonId: number | string) => `http://localhost/api/seasons/${seasonId}/status`;

function call(seasonId: number | string, sessionPlayerId: number | null, body: unknown) {
  if (sessionPlayerId == null) __setTestSession(null);
  else __setTestSession(sessionFor(sessionPlayerId));
  return PATCH(jsonRequest(url(seasonId), 'PATCH', body), { params: Promise.resolve({ id: String(seasonId) }) });
}

async function main() {
  await test('PATCH — unauthenticated request is rejected (401)', async () => {
    installFixture();
    const res = await call(UPCOMING_SEASON_ID, null, { status: 'ACTIVE' });
    assert.equal(res.status, 401);
  });

  await test('PATCH — non-admin is rejected (403)', async () => {
    installFixture();
    const res = await call(UPCOMING_SEASON_ID, PLAYER_ID, { status: 'ACTIVE' });
    assert.equal(res.status, 403);
  });

  await test('PATCH — non-numeric season id is rejected (400)', async () => {
    installFixture();
    const res = await call('abc', ADMIN_ID, { status: 'ACTIVE' });
    assert.equal(res.status, 400);
  });

  await test('PATCH — a status other than ACTIVE is rejected (400)', async () => {
    installFixture();
    const res = await call(UPCOMING_SEASON_ID, ADMIN_ID, { status: 'COMPLETED' });
    assert.equal(res.status, 400);
  });

  await test('PATCH — a missing/malformed body is rejected (400)', async () => {
    installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const res = await PATCH(jsonRequest(url(UPCOMING_SEASON_ID), 'PATCH'), { params: Promise.resolve({ id: String(UPCOMING_SEASON_ID) }) });
    assert.equal(res.status, 400);
  });

  await test('PATCH — an unknown season id is rejected (404)', async () => {
    installFixture();
    const res = await call(999, ADMIN_ID, { status: 'ACTIVE' });
    assert.equal(res.status, 404);
  });

  await test('PATCH — a gauntlet season id is rejected (404, "Regular season not found")', async () => {
    installFixture();
    const res = await call(GAUNTLET_SEASON_ID, ADMIN_ID, { status: 'ACTIVE' });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'Regular season not found');
  });

  await test('PATCH — a season that isn\'t UPCOMING is rejected (409)', async () => {
    installFixture();
    const res = await call(ACTIVE_SEASON_ID, ADMIN_ID, { status: 'ACTIVE' });
    assert.equal(res.status, 409);
  });

  await test('PATCH — admin activates an UPCOMING season and its gauntlet bracket builds (200)', async () => {
    const db = installFixture();
    const res = await call(UPCOMING_SEASON_ID, ADMIN_ID, { status: 'ACTIVE' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.gauntletBuilt, true);
    assert.equal(body.gauntletBuildError, null);

    assert.equal(db.seasons.find((s) => s.id === UPCOMING_SEASON_ID)!.status, 'ACTIVE');
    assert.ok(db.seasons.some((s) => s.is_gauntlet && s.name === 'Season 9 Gauntlet' && s.id !== GAUNTLET_SEASON_ID));
  });

  await test('PATCH — activation still succeeds (200) even when the gauntlet build isn\'t eligible', async () => {
    const db = installFixture();
    const res = await call(UPCOMING_NO_LEADERBOARD_ID, ADMIN_ID, { status: 'ACTIVE' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.gauntletBuilt, false);
    assert.ok(typeof body.gauntletBuildError === 'string' && body.gauntletBuildError.length > 0);
    assert.equal(db.seasons.find((s) => s.id === UPCOMING_NO_LEADERBOARD_ID)!.status, 'ACTIVE');
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

main();
