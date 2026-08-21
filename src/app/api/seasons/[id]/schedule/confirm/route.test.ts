/**
 * Route-handler harness for POST /api/seasons/[id]/schedule/confirm (#379) — exercises
 * requireAdminAccess()'s 401/403 branches and confirmSeasonScheduleDraft()'s
 * no-draft/invalid/already-materialized/confirmed outcomes through the exported handler directly.
 *
 * Run:  npx vitest run "src/app/api/seasons/[id]/schedule/confirm/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestClient } from '@/lib/supabase';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb, type Row } from '@/lib/test-support/fakeSupabase';
import { makeSeasonScheduleDraftRpcHandlers } from '@/lib/test-support/seasonScheduleDraftRpc';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { buildRosterSchedule } from '@/lib/season-schedule-engine';
import { POST } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const NO_DRAFT_SEASON_ID = 10;
const READY_DRAFT_SEASON_ID = 11;
const INCOMPLETE_DRAFT_SEASON_ID = 12;
const ALREADY_MATERIALIZED_SEASON_ID = 13;
const ACTIVE_SEASON_ID = 14;

const ROSTER = [1, 2, 3, 4, 5, 6, 7];
// The real generator's full plan (guaranteed round-robin-complete) for READY_DRAFT_SEASON_ID; just
// its first week — necessarily incomplete on its own — for INCOMPLETE_DRAFT_SEASON_ID.
const FULL_PLAN = buildRosterSchedule(ROSTER);

/** Persists `plan` into the draft tables for `seasonId`, mirroring what
 * generateSeasonScheduleDraft() itself writes — this test constructs the draft directly rather than
 * calling that function, to keep this file focused on the confirm route/engine call it's testing. */
function draftRowsFor(seasonId: number, plan: typeof FULL_PLAN, idOffset: number): { weeks: Row[]; matches: Row[] } {
  const weeks: Row[] = [];
  const matches: Row[] = [];
  plan.forEach((week, wi) => {
    const weekId = idOffset + wi;
    weeks.push({ id: weekId, season_id: seasonId, week_number: week.week, bye_player_id: week.byePlayerIds[0] ?? null });
    week.matches.forEach((m, mi) => {
      matches.push({
        id: idOffset * 100 + wi * 10 + mi,
        draft_week_id: weekId,
        match_number: mi + 1,
        shirts_player1_id: m.shirts[0],
        shirts_player2_id: m.shirts[1],
        skins_player1_id: m.skins[0],
        skins_player2_id: m.skins[1],
      });
    });
  });
  return { weeks, matches };
}

function makeDb(): FakeDb {
  const ready = draftRowsFor(READY_DRAFT_SEASON_ID, FULL_PLAN, 1000);
  const incomplete = draftRowsFor(INCOMPLETE_DRAFT_SEASON_ID, FULL_PLAN.slice(0, 1), 2000);
  const alreadyMaterialized = draftRowsFor(ALREADY_MATERIALIZED_SEASON_ID, FULL_PLAN, 3000);

  return {
    players: [
      { id: ADMIN_ID, is_admin: true, name: `Player ${ADMIN_ID}` },
      { id: PLAYER_ID, is_admin: false, name: `Player ${PLAYER_ID}` },
      ...ROSTER.filter((id) => id !== ADMIN_ID && id !== PLAYER_ID).map((id) => ({ id, is_admin: false, name: `Player ${id}` })),
    ],
    seasons: [
      { id: NO_DRAFT_SEASON_ID, name: 'Season 20', status: 'UPCOMING', is_gauntlet: false, target_win_rounds: 13 },
      { id: READY_DRAFT_SEASON_ID, name: 'Season 21', status: 'UPCOMING', is_gauntlet: false, target_win_rounds: 13 },
      { id: INCOMPLETE_DRAFT_SEASON_ID, name: 'Season 22', status: 'UPCOMING', is_gauntlet: false, target_win_rounds: 13 },
      { id: ALREADY_MATERIALIZED_SEASON_ID, name: 'Season 23', status: 'UPCOMING', is_gauntlet: false, target_win_rounds: 13 },
      { id: ACTIVE_SEASON_ID, name: 'Season 24', status: 'ACTIVE', is_gauntlet: false, target_win_rounds: 13 },
    ],
    season_players: [
      ...ROSTER.map((id, i) => ({ id: i + 1, season_id: READY_DRAFT_SEASON_ID, player_id: id })),
      ...ROSTER.map((id, i) => ({ id: 100 + i, season_id: INCOMPLETE_DRAFT_SEASON_ID, player_id: id })),
      ...ROSTER.map((id, i) => ({ id: 200 + i, season_id: ALREADY_MATERIALIZED_SEASON_ID, player_id: id })),
    ],
    season_schedule_draft_weeks: [...ready.weeks, ...incomplete.weeks, ...alreadyMaterialized.weeks],
    season_schedule_draft_matches: [...ready.matches, ...incomplete.matches, ...alreadyMaterialized.matches],
    weeks: [{ id: 999, season_id: ALREADY_MATERIALIZED_SEASON_ID, week_number: 1, bye_player_id: null }],
    matches: [],
    player_match_stats: [],
    ops_errors: [],
  };
}

function installFixture(): FakeDb {
  const db = makeDb();
  const client = createFakeSupabaseClient(db, makeSeasonScheduleDraftRpcHandlers());
  __setTestClient(client);
  __setTestAdminClient(client);
  return db;
}

const url = (seasonId: number | string) => `http://localhost/api/seasons/${seasonId}/schedule/confirm`;

function call(seasonId: number | string, sessionPlayerId: number | null) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return POST(jsonRequest(url(seasonId), 'POST'), { params: Promise.resolve({ id: String(seasonId) }) });
}

async function main() {
  await test('POST — unauthenticated request is rejected (401)', async () => {
    installFixture();
    assert.equal((await call(READY_DRAFT_SEASON_ID, null)).status, 401);
  });

  await test('POST — non-admin is rejected (403)', async () => {
    installFixture();
    assert.equal((await call(READY_DRAFT_SEASON_ID, PLAYER_ID)).status, 403);
  });

  await test('POST — non-numeric season id is rejected (400)', async () => {
    installFixture();
    assert.equal((await call('abc', ADMIN_ID)).status, 400);
  });

  await test('POST — an unknown season id is rejected (404)', async () => {
    installFixture();
    assert.equal((await call(999, ADMIN_ID)).status, 404);
  });

  await test('POST — a season that isn\'t UPCOMING is rejected (400)', async () => {
    installFixture();
    assert.equal((await call(ACTIVE_SEASON_ID, ADMIN_ID)).status, 400);
  });

  await test('POST — no draft exists yet (400)', async () => {
    installFixture();
    const res = await call(NO_DRAFT_SEASON_ID, ADMIN_ID);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'No matchup draft exists yet — generate one first');
  });

  await test('POST — an incomplete draft is rejected with its coverage gaps (400)', async () => {
    installFixture();
    const res = await call(INCOMPLETE_DRAFT_SEASON_ID, ADMIN_ID);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Draft is not ready to confirm');
    assert.ok(body.missingTeammatePairs.length > 0 || body.missingOpponentPairs.length > 0);
  });

  await test('POST — a season that already has a real schedule is rejected (409)', async () => {
    installFixture();
    const res = await call(ALREADY_MATERIALIZED_SEASON_ID, ADMIN_ID);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'This season already has a real schedule');
  });

  await test('POST — admin confirms a ready draft, materializing real weeks/matches (201)', async () => {
    const db = installFixture();
    const expectedMatches = FULL_PLAN.reduce((n, w) => n + w.matches.length, 0);
    const res = await call(READY_DRAFT_SEASON_ID, ADMIN_ID);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.weeksCreated, FULL_PLAN.length);
    assert.equal(body.matchesCreated, expectedMatches);
    assert.equal(db.weeks.filter((w) => w.season_id === READY_DRAFT_SEASON_ID).length, FULL_PLAN.length);
    assert.equal(db.matches.length, expectedMatches);
    assert.equal(db.player_match_stats.length, expectedMatches * 4);
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
