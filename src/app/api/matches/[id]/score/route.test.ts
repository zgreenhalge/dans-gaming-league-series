/**
 * Route-handler harness for PATCH /api/matches/[id]/score (#379) — exercises the route's own inline
 * admin-or-in-match access gate, its already-played/veto-complete checks, and writeMatchScore()'s
 * validation + persisted score/stats through the exported handler directly.
 *
 * writeMatchScore() defers its post-score hooks (rating recompute, gauntlet/season completion,
 * steam-id learning) via the route's own `after` import (`@/lib/after`, not `next/server`'s `after`
 * directly — see after.ts) — `__setTestAfterMode(true)`/`__flushTestAfter()` let this test run those
 * hooks to completion deterministically instead of them throwing "called outside a request scope" or
 * silently never running.
 *
 * Run:  npx tsx "src/app/api/matches/[id]/score/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestClient } from '@/lib/supabase';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { __setTestAfterMode, __flushTestAfter } from '@/lib/after';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { PATCH } from './route';

const ADMIN_ID = 1;
const IN_MATCH_PLAYER_ID = 2;
const OUT_OF_MATCH_PLAYER_ID = 3;
const SHIRTS2_ID = 4;
const SKINS1_ID = 5;
const SKINS2_ID = 6;

const READY_MATCH_ID = 100;
const PLAYED_MATCH_ID = 101;
const VETO_INCOMPLETE_MATCH_ID = 102;

function vetoCompleteFields() {
  return {
    shirts_ban: 'Vertigo', shirts_ban2: 'Nuke', skins_ban1: 'Inferno', skins_ban2: 'Overpass',
    shirts_pick: 'Foroglio', skins_starting_side: 'CT',
  };
}

function makeDb(): FakeDb {
  return {
    players: [
      { id: ADMIN_ID, is_admin: true, name: 'Admin' },
      { id: IN_MATCH_PLAYER_ID, is_admin: false, name: 'In Match' },
      { id: OUT_OF_MATCH_PLAYER_ID, is_admin: false, name: 'Out Of Match' },
      { id: SHIRTS2_ID, is_admin: false, name: 'Shirts 2' },
      { id: SKINS1_ID, is_admin: false, name: 'Skins 1' },
      { id: SKINS2_ID, is_admin: false, name: 'Skins 2' },
    ],
    seasons: [{ id: 20, name: 'Season 50', status: 'ACTIVE', is_gauntlet: false, target_win_rounds: 13 }],
    weeks: [{ id: 10, season_id: 20, week_number: 1, bye_player_id: null }],
    matches: [
      { id: READY_MATCH_ID, week_id: 10, match_number: 1, final_score: null, is_playoff_game: false, round_history: null, ...vetoCompleteFields() },
      { id: PLAYED_MATCH_ID, week_id: 10, match_number: 2, final_score: '13-9', is_playoff_game: false, round_history: null, ...vetoCompleteFields() },
      { id: VETO_INCOMPLETE_MATCH_ID, week_id: 10, match_number: 3, final_score: null, is_playoff_game: false, round_history: null, shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null, shirts_pick: null, skins_starting_side: null },
    ],
    player_match_stats: [READY_MATCH_ID, PLAYED_MATCH_ID, VETO_INCOMPLETE_MATCH_ID].flatMap((matchId) => [
      { id: matchId * 10 + 1, match_id: matchId, player_id: IN_MATCH_PLAYER_ID, faction: 'SHIRTS', kills: 0, assists: 0, deaths: 0, damage: 0, adr: 0, rounds_played: 0, rounds_won: 0, is_win: false },
      { id: matchId * 10 + 2, match_id: matchId, player_id: SHIRTS2_ID, faction: 'SHIRTS', kills: 0, assists: 0, deaths: 0, damage: 0, adr: 0, rounds_played: 0, rounds_won: 0, is_win: false },
      { id: matchId * 10 + 3, match_id: matchId, player_id: SKINS1_ID, faction: 'SKINS', kills: 0, assists: 0, deaths: 0, damage: 0, adr: 0, rounds_played: 0, rounds_won: 0, is_win: false },
      { id: matchId * 10 + 4, match_id: matchId, player_id: SKINS2_ID, faction: 'SKINS', kills: 0, assists: 0, deaths: 0, damage: 0, adr: 0, rounds_played: 0, rounds_won: 0, is_win: false },
    ]),
    background_jobs: [],
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

const url = (matchId: number | string) => `http://localhost/api/matches/${matchId}/score`;
const validBody = () => ({
  shirts: 13,
  skins: 9,
  player_stats: [
    { player_id: IN_MATCH_PLAYER_ID, kills: 20, assists: 3, deaths: 10, damage: 1800 },
    { player_id: SHIRTS2_ID, kills: 18, assists: 2, deaths: 12, damage: 1600 },
    { player_id: SKINS1_ID, kills: 12, assists: 4, deaths: 18, damage: 1200 },
    { player_id: SKINS2_ID, kills: 10, assists: 5, deaths: 20, damage: 1100 },
  ],
});

function call(matchId: number | string, sessionPlayerId: number | null, body?: unknown) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return PATCH(jsonRequest(url(matchId), 'PATCH', body), { params: Promise.resolve({ id: String(matchId) }) });
}

async function main() {
  await test('PATCH — unauthenticated request is rejected (401)', async () => {
    installFixture();
    assert.equal((await call(READY_MATCH_ID, null, validBody())).status, 401);
  });

  await test('PATCH — non-numeric match id is rejected (400)', async () => {
    installFixture();
    assert.equal((await call('abc', ADMIN_ID, validBody())).status, 400);
  });

  await test('PATCH — an unknown match id is rejected (404)', async () => {
    installFixture();
    assert.equal((await call(999, ADMIN_ID, validBody())).status, 404);
  });

  await test('PATCH — a player neither admin nor in the match is rejected (403)', async () => {
    installFixture();
    assert.equal((await call(READY_MATCH_ID, OUT_OF_MATCH_PLAYER_ID, validBody())).status, 403);
  });

  await test('PATCH — a non-admin editing an already-played match is rejected (403)', async () => {
    installFixture();
    const res = await call(PLAYED_MATCH_ID, IN_MATCH_PLAYER_ID, validBody());
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'Only admins can edit a submitted result');
  });

  await test('PATCH — admin CAN edit an already-played match', async () => {
    __setTestAfterMode(true);
    const db = installFixture();
    const res = await call(PLAYED_MATCH_ID, ADMIN_ID, validBody());
    await __flushTestAfter();
    assert.equal(res.status, 200);
    assert.equal(db.matches.find((m) => m.id === PLAYED_MATCH_ID)!.final_score, '13-9');
    __setTestAfterMode(false);
  });

  await test('PATCH — an incomplete pick/ban phase is rejected (403)', async () => {
    installFixture();
    const res = await call(VETO_INCOMPLETE_MATCH_ID, ADMIN_ID, validBody());
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'Pick/ban phase not complete');
  });

  await test('PATCH — a missing/malformed body is rejected (400)', async () => {
    installFixture();
    __setTestSession(sessionFor(ADMIN_ID));
    const res = await PATCH(jsonRequest(url(READY_MATCH_ID), 'PATCH'), { params: Promise.resolve({ id: String(READY_MATCH_ID) }) });
    assert.equal(res.status, 400);
  });

  await test('PATCH — writeMatchScore\'s own validation (non-integer score) bubbles through', async () => {
    installFixture();
    const res = await call(READY_MATCH_ID, ADMIN_ID, { ...validBody(), shirts: 'thirteen' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'shirts and skins must be integers');
  });

  await test('PATCH — a stat row for a player not in the match is rejected (400)', async () => {
    installFixture();
    const res = await call(READY_MATCH_ID, ADMIN_ID, {
      ...validBody(),
      player_stats: [{ player_id: OUT_OF_MATCH_PLAYER_ID, kills: 1, assists: 0, deaths: 1, damage: 100 }],
    });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error.includes('is not in this match'));
  });

  await test('PATCH — the in-match player (non-admin) can submit their own match\'s score (200)', async () => {
    __setTestAfterMode(true);
    const db = installFixture();
    const res = await call(READY_MATCH_ID, IN_MATCH_PLAYER_ID, validBody());
    await __flushTestAfter();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.clone().json(), { ok: true });

    assert.equal(db.matches.find((m) => m.id === READY_MATCH_ID)!.final_score, '13-9');
    const shirtsRow = db.player_match_stats.find((s) => s.match_id === READY_MATCH_ID && s.player_id === IN_MATCH_PLAYER_ID)!;
    assert.equal(shirtsRow.kills, 20);
    assert.equal(shirtsRow.is_win, true);
    assert.equal(shirtsRow.rounds_won, 13);
    const skinsRow = db.player_match_stats.find((s) => s.match_id === READY_MATCH_ID && s.player_id === SKINS1_ID)!;
    assert.equal(skinsRow.is_win, false);
    assert.equal(skinsRow.rounds_won, 9);
    __setTestAfterMode(false);
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

main();
