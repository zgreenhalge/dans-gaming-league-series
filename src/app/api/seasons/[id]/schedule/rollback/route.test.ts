/**
 * Route-handler harness for POST /api/seasons/[id]/schedule/rollback (#320) — exercises
 * requireAdminAccess()'s 401/403 branches and rollbackSeasonScheduleDraft()'s
 * not-materialized/rolled-back outcomes (including the played-match protection) through the
 * exported handler directly.
 *
 * Run:  npx vitest run "src/app/api/seasons/[id]/schedule/rollback/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestClient } from '@/lib/supabase';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { makeSeasonScheduleDraftRpcHandlers } from '@/lib/test-support/seasonScheduleDraftRpc';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { POST } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const NO_SCHEDULE_SEASON_ID = 10;
const MATERIALIZED_SEASON_ID = 11;

function makeDb(): FakeDb {
  return {
    players: [
      { id: ADMIN_ID, is_admin: true, name: `Player ${ADMIN_ID}` },
      { id: PLAYER_ID, is_admin: false, name: `Player ${PLAYER_ID}` },
    ],
    seasons: [
      { id: NO_SCHEDULE_SEASON_ID, name: 'Season 20', status: 'UPCOMING', is_gauntlet: false, target_win_rounds: 13 },
      { id: MATERIALIZED_SEASON_ID, name: 'Season 21', status: 'UPCOMING', is_gauntlet: false, target_win_rounds: 13 },
    ],
    weeks: [
      { id: 1, season_id: MATERIALIZED_SEASON_ID, week_number: 1, bye_player_id: null },
      { id: 2, season_id: MATERIALIZED_SEASON_ID, week_number: 2, bye_player_id: null },
    ],
    matches: [
      { id: 1, week_id: 1, match_number: 1, is_playoff_game: false, final_score: '13-9' },
      { id: 2, week_id: 2, match_number: 1, is_playoff_game: false, final_score: null },
    ],
    player_match_stats: [],
  };
}

function installFixture(): FakeDb {
  const db = makeDb();
  const client = createFakeSupabaseClient(db, makeSeasonScheduleDraftRpcHandlers());
  __setTestClient(client);
  __setTestAdminClient(client);
  return db;
}

const url = (seasonId: number | string) => `http://localhost/api/seasons/${seasonId}/schedule/rollback`;

function call(seasonId: number | string, sessionPlayerId: number | null) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return POST(jsonRequest(url(seasonId), 'POST'), { params: Promise.resolve({ id: String(seasonId) }) });
}

async function main() {
  await test('POST — unauthenticated request is rejected (401)', async () => {
    installFixture();
    assert.equal((await call(MATERIALIZED_SEASON_ID, null)).status, 401);
  });

  await test('POST — non-admin is rejected (403)', async () => {
    installFixture();
    assert.equal((await call(MATERIALIZED_SEASON_ID, PLAYER_ID)).status, 403);
  });

  await test('POST — non-numeric season id is rejected (400)', async () => {
    installFixture();
    assert.equal((await call('abc', ADMIN_ID)).status, 400);
  });

  await test('POST — an unknown season id is rejected (404)', async () => {
    installFixture();
    assert.equal((await call(999, ADMIN_ID)).status, 404);
  });

  await test('POST — a season with no real schedule is rejected (400)', async () => {
    installFixture();
    const res = await call(NO_SCHEDULE_SEASON_ID, ADMIN_ID);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'This season has no real schedule to roll back');
  });

  await test('POST — deletes unplayed weeks, protecting the one with a played match (200)', async () => {
    const db = installFixture();
    const res = await call(MATERIALIZED_SEASON_ID, ADMIN_ID);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.weeksDeleted, 1);
    assert.deepEqual(body.protectedWeekNumbers, [1]);
    assert.deepEqual(
      db.weeks.filter((w) => w.season_id === MATERIALIZED_SEASON_ID).map((w) => w.week_number),
      [1],
    );
    assert.equal(db.matches.length, 1);
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
