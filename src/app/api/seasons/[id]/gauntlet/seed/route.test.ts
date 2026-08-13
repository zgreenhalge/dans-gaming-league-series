/**
 * Route-handler harness for POST /api/seasons/[id]/gauntlet/seed (#379) — exercises
 * requireAdminAccess()'s 401/403 branches and trySeedGauntlet()'s no-shape/already-seeded/drift/
 * seeded outcomes through the exported handler directly.
 *
 * Run:  npx tsx "src/app/api/seasons/[id]/gauntlet/seed/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestClient } from '@/lib/supabase';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { POST } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const NO_SHAPE_SEASON_ID = 10;
const READY_SEASON_ID = 11;
const ALREADY_SEEDED_SEASON_ID = 12;
const DRIFTED_SEASON_ID = 13;

function leaderboardFor(seasonId: number, playerIds: number[]): FakeDb['player_season_leaderboard'] {
  return playerIds.map((id, i) => ({ season_id: seasonId, player_id: id, player_name: `Player ${id}`, win_rate_percentage: 100 - i * 10 }));
}

function makeDb(): FakeDb {
  const players = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, is_admin: i === 0, name: `Player ${i + 1}` }));

  return {
    players,
    seasons: [
      { id: NO_SHAPE_SEASON_ID, name: 'Season 30', status: 'COMPLETED', is_gauntlet: false, target_win_rounds: 13 },
      // Seeding materializes round 1 immediately once the regular season is done — COMPLETED here
      // matches the real trigger condition (regularSeasonIsDone() in gauntlet-engine.ts).
      { id: READY_SEASON_ID, name: 'Season 31', status: 'COMPLETED', is_gauntlet: false, target_win_rounds: 13 },
      { id: 111, name: 'Season 31 Gauntlet', status: 'ACTIVE', is_gauntlet: true, target_win_rounds: 13 },
      { id: ALREADY_SEEDED_SEASON_ID, name: 'Season 32', status: 'COMPLETED', is_gauntlet: false, target_win_rounds: 13 },
      { id: 121, name: 'Season 32 Gauntlet', status: 'ACTIVE', is_gauntlet: true, target_win_rounds: 13 },
      { id: DRIFTED_SEASON_ID, name: 'Season 33', status: 'COMPLETED', is_gauntlet: false, target_win_rounds: 13 },
      { id: 131, name: 'Season 33 Gauntlet', status: 'ACTIVE', is_gauntlet: true, target_win_rounds: 13 },
    ],
    // READY_SEASON_ID: 4-player leaderboard, gauntlet shape built for 4 (round1 seeds 1-4, unseeded).
    // ALREADY_SEEDED_SEASON_ID: shape already seeded (a real gauntlet round exists — via a played
    // match — so getGauntletRounds() returns something).
    // DRIFTED_SEASON_ID: shape built for 4 qualifiers, but the season now has 6 — a roster drift.
    player_season_leaderboard: [
      ...leaderboardFor(READY_SEASON_ID, [1, 2, 3, 4]),
      ...leaderboardFor(ALREADY_SEEDED_SEASON_ID, [1, 2, 3, 4]),
      ...leaderboardFor(DRIFTED_SEASON_ID, [1, 2, 3, 4, 5, 6]),
    ],
    gauntlet_pods: [
      { id: 1000, season_id: 111, round_number: 1, pod_index: 0, advance_rule: 'single', is_final: true, week_id: null, match1_id: null, match2_id: null },
      { id: 1001, season_id: 121, round_number: 1, pod_index: 0, advance_rule: 'single', is_final: true, week_id: 500, match1_id: 5000, match2_id: null },
      { id: 1002, season_id: 131, round_number: 1, pod_index: 0, advance_rule: 'single', is_final: true, week_id: null, match1_id: null, match2_id: null },
    ],
    gauntlet_pod_slots: [
      { id: 1, pod_id: 1000, slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: null },
      { id: 2, pod_id: 1000, slot_index: 1, source_kind: 'seed', source_seed: 2, source_pod_id: null, player_id: null },
      { id: 3, pod_id: 1000, slot_index: 2, source_kind: 'seed', source_seed: 3, source_pod_id: null, player_id: null },
      { id: 4, pod_id: 1000, slot_index: 3, source_kind: 'seed', source_seed: 4, source_pod_id: null, player_id: null },
      { id: 5, pod_id: 1001, slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: 1 },
      { id: 6, pod_id: 1001, slot_index: 1, source_kind: 'seed', source_seed: 2, source_pod_id: null, player_id: 2 },
      { id: 7, pod_id: 1001, slot_index: 2, source_kind: 'seed', source_seed: 3, source_pod_id: null, player_id: 3 },
      { id: 8, pod_id: 1001, slot_index: 3, source_kind: 'seed', source_seed: 4, source_pod_id: null, player_id: 4 },
      { id: 9, pod_id: 1002, slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: null },
      { id: 10, pod_id: 1002, slot_index: 1, source_kind: 'seed', source_seed: 2, source_pod_id: null, player_id: null },
      { id: 11, pod_id: 1002, slot_index: 2, source_kind: 'seed', source_seed: 3, source_pod_id: null, player_id: null },
      { id: 12, pod_id: 1002, slot_index: 3, source_kind: 'seed', source_seed: 4, source_pod_id: null, player_id: null },
    ],
    weeks: [{ id: 500, season_id: 121, week_number: 1, bye_player_id: null }],
    matches: [{ id: 5000, week_id: 500, match_number: 1, final_score: '13-9', is_playoff_game: true }],
    player_match_stats: [],
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

const url = (seasonId: number | string) => `http://localhost/api/seasons/${seasonId}/gauntlet/seed`;

function call(seasonId: number | string, sessionPlayerId: number | null) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return POST(jsonRequest(url(seasonId), 'POST'), { params: Promise.resolve({ id: String(seasonId) }) });
}

async function main() {
  await test('POST — unauthenticated request is rejected (401)', async () => {
    installFixture();
    assert.equal((await call(READY_SEASON_ID, null)).status, 401);
  });

  await test('POST — non-admin is rejected (403)', async () => {
    installFixture();
    assert.equal((await call(READY_SEASON_ID, PLAYER_ID)).status, 403);
  });

  await test('POST — non-numeric season id is rejected (400)', async () => {
    installFixture();
    assert.equal((await call('abc', ADMIN_ID)).status, 400);
  });

  await test('POST — a season with no gauntlet shape is rejected (404)', async () => {
    installFixture();
    const res = await call(NO_SHAPE_SEASON_ID, ADMIN_ID);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'This season has no gauntlet shape to seed — build it first');
  });

  await test('POST — an already-seeded gauntlet is rejected (409)', async () => {
    installFixture();
    const res = await call(ALREADY_SEEDED_SEASON_ID, ADMIN_ID);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'This gauntlet is already seeded');
  });

  await test('POST — a roster that drifted since the shape was built is rejected (409)', async () => {
    installFixture();
    const res = await call(DRIFTED_SEASON_ID, ADMIN_ID);
    assert.equal(res.status, 409);
    assert.ok((await res.json()).error.includes('drifted'));
  });

  await test('POST — admin seeds a ready gauntlet, materializing round 1 (200)', async () => {
    const db = installFixture();
    const res = await call(READY_SEASON_ID, ADMIN_ID);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.seed_bands.playing.sort(), ['Player 1', 'Player 2', 'Player 3', 'Player 4'].sort());
    assert.deepEqual(body.seed_bands.byes, []);
    assert.deepEqual(body.seed_bands.relegated, []);

    const slots = db.gauntlet_pod_slots.filter((s) => s.pod_id === 1000).sort((a, b) => (a.slot_index as number) - (b.slot_index as number));
    assert.deepEqual(slots.map((s) => s.player_id), [1, 2, 3, 4]);
    assert.ok(db.gauntlet_pods.find((p) => p.id === 1000)!.match1_id != null, 'round 1 should have materialized');
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

main();
