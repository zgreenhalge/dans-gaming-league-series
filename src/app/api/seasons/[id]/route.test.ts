/**
 * Route-handler harness for DELETE /api/seasons/[id] — admin-only, the id and each refusal
 * `delete_upcoming_season()` reports, what a successful delete removes (the season, its roster and its
 * schedule draft, and nothing of another season's), and that a failed delete leaves everything in place.
 *
 * Run:  npx vitest run "src/app/api/seasons/[id]/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, FakeRpcError, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { seasonDeleteRpcs } from '@/lib/test-support/seasonDeleteRpc';
import { MALFORMED_ROUTE_IDS, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { NextRequest } from 'next/server';
import { DELETE } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const UPCOMING_ID = 10;
const ACTIVE_ID = 11;
const GAUNTLET_ID = 12;
const SCHEDULED_ID = 13;
const OTHER_UPCOMING_ID = 14;

function installFixture(rpcs = seasonDeleteRpcs): FakeDb {
  const db: FakeDb = {
    players: [
      { id: ADMIN_ID, is_admin: true },
      { id: PLAYER_ID, is_admin: false },
    ],
    seasons: [
      { id: UPCOMING_ID, name: 'Season 1', status: 'UPCOMING', is_gauntlet: false },
      { id: ACTIVE_ID, name: 'Season 2', status: 'ACTIVE', is_gauntlet: false },
      { id: GAUNTLET_ID, name: 'Season 2 Gauntlet', status: 'UPCOMING', is_gauntlet: true },
      { id: SCHEDULED_ID, name: 'Season 3', status: 'UPCOMING', is_gauntlet: false },
      { id: OTHER_UPCOMING_ID, name: 'Season 4', status: 'UPCOMING', is_gauntlet: false },
    ],
    season_players: [
      { id: 1, season_id: UPCOMING_ID, player_id: PLAYER_ID },
      { id: 2, season_id: UPCOMING_ID, player_id: ADMIN_ID },
      { id: 3, season_id: SCHEDULED_ID, player_id: PLAYER_ID },
      { id: 4, season_id: OTHER_UPCOMING_ID, player_id: PLAYER_ID },
    ],
    season_schedule_draft_weeks: [
      { id: 1, season_id: UPCOMING_ID, week_number: 1, bye_player_id: null },
      { id: 2, season_id: OTHER_UPCOMING_ID, week_number: 1, bye_player_id: null },
    ],
    season_schedule_draft_matches: [
      { id: 1, draft_week_id: 1, match_number: 1 },
      { id: 2, draft_week_id: 2, match_number: 1 },
    ],
    weeks: [{ id: 1, season_id: SCHEDULED_ID, week_number: 1 }],
  };
  __setTestAdminClient(createFakeSupabaseClient(db, rpcs));
  return db;
}

function call(id: string | number, sessionPlayerId: number | null) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return DELETE(new NextRequest(`http://localhost/api/seasons/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id: String(id) }),
  });
}

const seasonIds = (db: FakeDb) => db.seasons.map((s) => s.id);

/** A snapshot of every table the delete touches, to compare before and after a refused delete. */
const touched = (db: FakeDb) =>
  JSON.stringify([db.seasons, db.season_players, db.season_schedule_draft_weeks, db.season_schedule_draft_matches, db.weeks]);

async function main() {
  await test('DELETE — unauthenticated (401) and non-admin (403) are rejected and delete nothing', async () => {
    const db = installFixture();
    const before = touched(db);
    assert.equal((await call(UPCOMING_ID, null)).status, 401);
    assert.equal((await call(UPCOMING_ID, PLAYER_ID)).status, 403);
    assert.equal(touched(db), before);
  });

  await test('DELETE — a malformed season id is a 400', async () => {
    installFixture();
    for (const bad of MALFORMED_ROUTE_IDS) assert.equal((await call(bad, ADMIN_ID)).status, 400, bad);
  });

  await test('DELETE — a missing season is a 404', async () => {
    const db = installFixture();
    const res = await call(999, ADMIN_ID);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'Season not found');
    assert.equal(db.seasons.length, 5);
  });

  await test('DELETE — an ACTIVE season and a gauntlet season are a 400 and stay', async () => {
    const db = installFixture();
    const before = touched(db);
    for (const id of [ACTIVE_ID, GAUNTLET_ID]) {
      const res = await call(id, ADMIN_ID);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, 'Only an upcoming season can be deleted');
    }
    assert.equal(touched(db), before);
  });

  await test('DELETE — a season that already has weeks is a 400, with its roster and weeks kept', async () => {
    const db = installFixture();
    const before = touched(db);
    const res = await call(SCHEDULED_ID, ADMIN_ID);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'This season already has a schedule and cannot be deleted here');
    assert.equal(touched(db), before);
  });

  await test('DELETE — an admin deletes an UPCOMING season with its roster and draft, and only those (200)', async () => {
    const db = installFixture();
    assert.equal((await call(UPCOMING_ID, ADMIN_ID)).status, 200);

    assert.deepEqual(seasonIds(db), [ACTIVE_ID, GAUNTLET_ID, SCHEDULED_ID, OTHER_UPCOMING_ID]);
    assert.ok(db.season_players.every((p) => p.season_id !== UPCOMING_ID));
    assert.equal(db.season_players.length, 2);
    assert.deepEqual(db.season_schedule_draft_weeks.map((w) => w.season_id), [OTHER_UPCOMING_ID]);
    assert.deepEqual(db.season_schedule_draft_matches.map((m) => m.draft_week_id), [2]);
    assert.equal(db.weeks.length, 1);
  });

  await test('DELETE — a failure inside the delete is a 500 with its message, and nothing is half-deleted', async () => {
    const db = installFixture({
      delete_upcoming_season: () => {
        throw new FakeRpcError('deadlock detected');
      },
    });
    const before = touched(db);
    const res = await call(UPCOMING_ID, ADMIN_ID);
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, 'deadlock detected');
    assert.equal(touched(db), before);
  });

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
