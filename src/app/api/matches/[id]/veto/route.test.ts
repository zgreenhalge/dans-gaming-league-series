/**
 * Route-handler harness for PATCH /api/matches/[id]/veto (#379) — exercises the route's own inline
 * admin-or-in-match access gate, the already-played/scheduling-window checks, gauntlet (simultaneous,
 * fixed-slot) vs. regular (sequential, turn-based) pick/ban rules, map-pool/side validation, the
 * gauntlet auto-pick-remaining-map step, and the auto-provision-on-veto-complete side effect.
 *
 * Run:  npx vitest run "src/app/api/matches/[id]/veto/route.test.ts"
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
const OUT_OF_MATCH_ID = 9;

const MAP_POOL = ['Foroglio', 'Vertigo', 'Cobblestone', 'Nuke', 'Inferno'];

// Gauntlet match: shirts = [10, 11] (10 gets shirts_ban, 11 gets shirts_ban2 — lower id first),
// skins = [12, 13] (12 gets skins_ban1, 13 gets skins_ban2).
const GAUNTLET_MATCH_ID = 200;
const G_SHIRTS1 = 10, G_SHIRTS2 = 11, G_SKINS1 = 12, G_SKINS2 = 13;

// Regular match: shirts = [20, 21], skins = [22, 23].
const REGULAR_MATCH_ID = 210;
const R_SHIRTS1 = 20, R_SHIRTS2 = 21, R_SKINS1 = 22, R_SKINS2 = 23;

const PLAYED_MATCH_ID = 220;
const UNSCHEDULED_MATCH_ID = 230;
const FAR_FUTURE_MATCH_ID = 240;

function participantsOf(matchId: number, shirts: [number, number], skins: [number, number]) {
  return [
    { id: matchId * 10 + 1, match_id: matchId, player_id: shirts[0], faction: 'SHIRTS' },
    { id: matchId * 10 + 2, match_id: matchId, player_id: shirts[1], faction: 'SHIRTS' },
    { id: matchId * 10 + 3, match_id: matchId, player_id: skins[0], faction: 'SKINS' },
    { id: matchId * 10 + 4, match_id: matchId, player_id: skins[1], faction: 'SKINS' },
  ];
}

function makeDb(): FakeDb {
  return {
    players: [
      { id: ADMIN_ID, is_admin: true, name: 'Admin' },
      { id: OUT_OF_MATCH_ID, is_admin: false, name: 'Outsider' },
      ...[G_SHIRTS1, G_SHIRTS2, G_SKINS1, G_SKINS2, R_SHIRTS1, R_SHIRTS2, R_SKINS1, R_SKINS2].map((id) => ({ id, is_admin: false, name: `Player ${id}` })),
    ],
    seasons: [
      { id: 1, name: 'Season 60 Gauntlet', is_gauntlet: true, map_pool: MAP_POOL, status: 'ACTIVE' },
      { id: 2, name: 'Season 60', is_gauntlet: false, map_pool: MAP_POOL, status: 'ACTIVE' },
    ],
    weeks: [
      { id: 1, season_id: 1, week_number: 1, bye_player_id: null },
      { id: 2, season_id: 2, week_number: 1, bye_player_id: null },
    ],
    matches: [
      { id: GAUNTLET_MATCH_ID, week_id: 1, match_number: 1, final_score: null, scheduled_at: '2026-01-01T00:00:00.000Z', shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null, shirts_pick: null, skins_starting_side: null },
      { id: REGULAR_MATCH_ID, week_id: 2, match_number: 1, final_score: null, scheduled_at: '2026-01-01T00:00:00.000Z', shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null, shirts_pick: null, skins_starting_side: null },
      { id: PLAYED_MATCH_ID, week_id: 2, match_number: 2, final_score: '13-9', scheduled_at: '2026-01-01T00:00:00.000Z', shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null, shirts_pick: null, skins_starting_side: null },
      { id: UNSCHEDULED_MATCH_ID, week_id: 2, match_number: 3, final_score: null, scheduled_at: null, shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null, shirts_pick: null, skins_starting_side: null },
      { id: FAR_FUTURE_MATCH_ID, week_id: 2, match_number: 4, final_score: null, scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null, shirts_pick: null, skins_starting_side: null },
    ],
    player_match_stats: [
      ...participantsOf(GAUNTLET_MATCH_ID, [G_SHIRTS1, G_SHIRTS2], [G_SKINS1, G_SKINS2]),
      ...participantsOf(REGULAR_MATCH_ID, [R_SHIRTS1, R_SHIRTS2], [R_SKINS1, R_SKINS2]),
      ...participantsOf(PLAYED_MATCH_ID, [R_SHIRTS1, R_SHIRTS2], [R_SKINS1, R_SKINS2]),
      ...participantsOf(UNSCHEDULED_MATCH_ID, [R_SHIRTS1, R_SHIRTS2], [R_SKINS1, R_SKINS2]),
      ...participantsOf(FAR_FUTURE_MATCH_ID, [R_SHIRTS1, R_SHIRTS2], [R_SKINS1, R_SKINS2]),
    ],
    match_server_state: [],
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

const url = (matchId: number | string) => `http://localhost/api/matches/${matchId}/veto`;

function call(matchId: number | string, sessionPlayerId: number | null, body?: unknown) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return PATCH(jsonRequest(url(matchId), 'PATCH', body), { params: Promise.resolve({ id: String(matchId) }) });
}

async function main() {
  await test('PATCH — unauthenticated request is rejected (401)', async () => {
    installFixture();
    assert.equal((await call(GAUNTLET_MATCH_ID, null, { field: 'shirts_ban', value: 'Foroglio' })).status, 401);
  });

  await test('PATCH — a player outside the match is rejected (403)', async () => {
    installFixture();
    assert.equal((await call(GAUNTLET_MATCH_ID, OUT_OF_MATCH_ID, { field: 'shirts_ban', value: 'Foroglio' })).status, 403);
  });

  await test('PATCH — an already-played match is rejected (403)', async () => {
    installFixture();
    const res = await call(PLAYED_MATCH_ID, ADMIN_ID, { field: 'shirts_ban', value: 'Foroglio' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'Match already played');
  });

  await test('PATCH — a non-admin on an unscheduled match is rejected (403)', async () => {
    installFixture();
    const res = await call(UNSCHEDULED_MATCH_ID, R_SHIRTS1, { field: 'shirts_ban', value: 'Foroglio' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'Match not yet scheduled');
  });

  await test('PATCH — a non-admin outside the 10-minute veto window is rejected (403)', async () => {
    installFixture();
    const res = await call(FAR_FUTURE_MATCH_ID, R_SHIRTS1, { field: 'shirts_ban', value: 'Foroglio' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'Veto window not open yet');
  });

  await test('PATCH — admin bypasses the scheduling window entirely', async () => {
    installFixture();
    const res = await call(FAR_FUTURE_MATCH_ID, ADMIN_ID, { field: 'shirts_ban', value: 'Foroglio' });
    assert.equal(res.status, 200);
  });

  await test('PATCH — a missing field/value is rejected (400)', async () => {
    installFixture();
    assert.equal((await call(GAUNTLET_MATCH_ID, ADMIN_ID, { field: 'shirts_ban' })).status, 400);
  });

  await test('PATCH — an invalid field name is rejected (400)', async () => {
    installFixture();
    assert.equal((await call(GAUNTLET_MATCH_ID, ADMIN_ID, { field: 'nonsense', value: 'Foroglio' })).status, 400);
  });

  await test('PATCH — a non-admin clearing a field is rejected (403)', async () => {
    installFixture();
    const res = await call(GAUNTLET_MATCH_ID, G_SHIRTS1, { field: 'shirts_ban', value: null });
    assert.equal(res.status, 403);
  });

  await test('PATCH — admin can clear a field (200)', async () => {
    const db = installFixture();
    db.matches.find((m) => m.id === GAUNTLET_MATCH_ID)!.shirts_ban = 'Foroglio';
    const res = await call(GAUNTLET_MATCH_ID, ADMIN_ID, { field: 'shirts_ban', value: null });
    assert.equal(res.status, 200);
    assert.equal(db.matches.find((m) => m.id === GAUNTLET_MATCH_ID)!.shirts_ban, null);
  });

  await test('PATCH — gauntlet: shirts_pick/skins_starting_side are not valid fields (400)', async () => {
    installFixture();
    const res = await call(GAUNTLET_MATCH_ID, ADMIN_ID, { field: 'shirts_pick', value: 'Foroglio' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Not a valid gauntlet field');
  });

  await test('PATCH — gauntlet: a player banning for the wrong faction is rejected (403)', async () => {
    installFixture();
    const res = await call(GAUNTLET_MATCH_ID, G_SHIRTS1, { field: 'skins_ban1', value: 'Foroglio' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "Not your faction's ban");
  });

  await test('PATCH — gauntlet: a player submitting their teammate\'s ban slot is rejected (403)', async () => {
    installFixture();
    const res = await call(GAUNTLET_MATCH_ID, G_SHIRTS1, { field: 'shirts_ban2', value: 'Foroglio' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'Not your ban slot');
  });

  await test('PATCH — gauntlet: each player fills their own slot; the 4th ban auto-picks the sole remaining map', async () => {
    const db = installFixture();
    assert.equal((await call(GAUNTLET_MATCH_ID, G_SHIRTS1, { field: 'shirts_ban', value: 'Foroglio' })).status, 200);
    assert.equal((await call(GAUNTLET_MATCH_ID, G_SHIRTS2, { field: 'shirts_ban2', value: 'Vertigo' })).status, 200);
    assert.equal((await call(GAUNTLET_MATCH_ID, G_SKINS1, { field: 'skins_ban1', value: 'Cobblestone' })).status, 200);
    assert.equal((await call(GAUNTLET_MATCH_ID, G_SKINS2, { field: 'skins_ban2', value: 'Nuke' })).status, 200);

    const m = db.matches.find((mm) => mm.id === GAUNTLET_MATCH_ID)!;
    assert.equal(m.shirts_pick, 'Inferno', 'the one map left out of the 4 bans should be auto-picked');
  });

  await test('PATCH — regular: shirts_ban2 is not a valid field for this match type (400)', async () => {
    installFixture();
    const res = await call(REGULAR_MATCH_ID, ADMIN_ID, { field: 'shirts_ban2', value: 'Foroglio' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Invalid field for this match type');
  });

  await test('PATCH — regular: filling out of sequence is rejected (400)', async () => {
    installFixture();
    const res = await call(REGULAR_MATCH_ID, ADMIN_ID, { field: 'skins_ban1', value: 'Foroglio' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Expected next field: shirts_ban');
  });

  await test('PATCH — regular: a non-admin acting out of faction turn is rejected (403)', async () => {
    installFixture();
    const res = await call(REGULAR_MATCH_ID, R_SKINS1, { field: 'shirts_ban', value: 'Foroglio' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "Not your faction's turn");
  });

  await test('PATCH — a side value other than CT/T is rejected (400)', async () => {
    const db = installFixture();
    Object.assign(db.matches.find((m) => m.id === REGULAR_MATCH_ID)!, {
      shirts_ban: 'Foroglio', skins_ban1: 'Vertigo', skins_ban2: 'Cobblestone', shirts_pick: 'Nuke',
    });
    const res = await call(REGULAR_MATCH_ID, ADMIN_ID, { field: 'skins_starting_side', value: 'sideways' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Side must be CT or T');
  });

  await test('PATCH — a map outside the pool is rejected (400)', async () => {
    installFixture();
    const res = await call(REGULAR_MATCH_ID, ADMIN_ID, { field: 'shirts_ban', value: 'de_dust2' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Map not in pool');
  });

  await test('PATCH — a map already used by another field is rejected (400)', async () => {
    const db = installFixture();
    db.matches.find((m) => m.id === REGULAR_MATCH_ID)!.shirts_ban = 'Foroglio';
    const res = await call(REGULAR_MATCH_ID, ADMIN_ID, { field: 'skins_ban1', value: 'Foroglio' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Map already used');
  });

  await test('PATCH — regular: completing the pick/ban phase auto-provisions the match server', async () => {
    __setTestAfterMode(true);
    process.env.MATCHZY_CONFIG_SECRET = 'test-secret';
    const db = installFixture();
    Object.assign(db.matches.find((m) => m.id === REGULAR_MATCH_ID)!, {
      shirts_ban: 'Foroglio', skins_ban1: 'Vertigo', skins_ban2: 'Cobblestone', shirts_pick: 'Nuke',
    });
    const res = await call(REGULAR_MATCH_ID, ADMIN_ID, { field: 'skins_starting_side', value: 'CT' });
    assert.equal(res.status, 200);
    await __flushTestAfter();

    // No DATHOST_SERVER_ID configured in this environment, so provisionMatchServer() fails fast —
    // the point here is only that auto-provision actually fired (and its failure was handled, not
    // left as an unhandled rejection), which a recorded ops-error demonstrates.
    assert.ok(db.ops_errors.some((e) => e.entity_id === REGULAR_MATCH_ID && e.operation === 'server_provision'));

    delete process.env.MATCHZY_CONFIG_SECRET;
    __setTestAfterMode(false);
  });

  __setTestSession(undefined);
  __setTestClient(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
