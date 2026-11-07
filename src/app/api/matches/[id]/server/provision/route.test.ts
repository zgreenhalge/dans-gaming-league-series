/**
 * Route-handler harness for POST /api/matches/[id]/server/provision (#379) — exercises
 * requireMatchAccess()'s admin-or-in-match gate, the hosting-not-configured and server-busy
 * pre-checks, a league match's forceable `server_occupied` check on a live server, a scrim match's side choice
 * becoming its starting side, and that the deferred
 * provisionMatchServer() call actually fires (and its failure is
 * handled, not left unhandled) via __setTestAfterMode()/__flushTestAfter().
 *
 * No live DatHost connection exists here, so provisionMatchServer() itself always fails fast (no
 * DATHOST_SERVER_ID configured, or no real network) — per docs/patterns.md's IO-boundary convention,
 * this test doesn't mock the DatHost call, it only asserts the failure is captured via
 * provisionErrorHandler()'s recordOpsError(), the same as veto/route.test.ts's auto-provision case.
 *
 * Run:  npx vitest run "src/app/api/matches/[id]/server/provision/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { __setTestAfterMode, __flushTestAfter } from '@/lib/after';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { POST } from './route';

const ADMIN_ID = 1;
const IN_MATCH_ID = 2;
const OUT_OF_MATCH_ID = 3;
const MATCH_ID = 100;
const BUSY_MATCH_ID = 101;
const OCCUPYING_MATCH_ID = 999;

function makeDb(): FakeDb {
  return {
    players: [
      { id: ADMIN_ID, is_admin: true },
      { id: IN_MATCH_ID, is_admin: false },
      { id: OUT_OF_MATCH_ID, is_admin: false },
    ],
    player_match_stats: [
      { id: 1, match_id: MATCH_ID, player_id: IN_MATCH_ID, faction: 'SHIRTS' },
      { id: 2, match_id: BUSY_MATCH_ID, player_id: IN_MATCH_ID, faction: 'SHIRTS' },
    ],
    match_server_state: [
      { match_id: OCCUPYING_MATCH_ID, server_state: 'live', dathost_server_id: 'srv-1', connect_string: '1.2.3.4:27015', server_started_at: null, teardown_at: null },
    ],
    ops_errors: [],
  };
}

function installFixture(): FakeDb {
  const db = makeDb();
  const client = createFakeSupabaseClient(db);
  __setTestAdminClient(client);
  return db;
}

const url = (matchId: number | string) => `http://localhost/api/matches/${matchId}/server/provision`;

function call(matchId: number | string, sessionPlayerId: number | null, body?: unknown) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return POST(jsonRequest(url(matchId), 'POST', body), { params: Promise.resolve({ id: String(matchId) }) });
}

/** Answers DatHost's `GET /game-servers/<id>` with a live server holding `playersOnline` players
 *  outside any DGLS match; every other DatHost call fails fast, as with no network. */
async function withLiveServer<T>(playersOnline: number, fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  process.env.DATHOST_SERVER_ID = 'srv-1';
  process.env.DATHOST_EMAIL = 'test@example.com';
  process.env.DATHOST_PASSWORD = 'test';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/game-servers/srv-1') && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ id: 'srv-1', on: true, booting: false, players_online: playersOnline }), { status: 200 });
    }
    throw new Error('offline');
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.DATHOST_SERVER_ID;
    delete process.env.DATHOST_EMAIL;
    delete process.env.DATHOST_PASSWORD;
  }
}

async function main() {
  await test('POST — non-numeric match id is rejected (400)', async () => {
    installFixture();
    assert.equal((await call('abc', ADMIN_ID)).status, 400);
  });

  await test('POST — unauthenticated request is rejected (401)', async () => {
    installFixture();
    assert.equal((await call(MATCH_ID, null)).status, 401);
  });

  await test('POST — a player outside the match is rejected (403)', async () => {
    installFixture();
    assert.equal((await call(MATCH_ID, OUT_OF_MATCH_ID)).status, 403);
  });

  await test('POST — hosting not configured is rejected (503)', async () => {
    installFixture();
    delete process.env.MATCHZY_CONFIG_SECRET;
    const res = await call(MATCH_ID, ADMIN_ID);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'Server hosting not configured');
  });

  await test('POST — another match already occupying the shared server is rejected (409)', async () => {
    installFixture();
    process.env.MATCHZY_CONFIG_SECRET = 'test-secret';
    process.env.DATHOST_SERVER_ID = 'srv-1';
    const res = await call(BUSY_MATCH_ID, ADMIN_ID);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.ok(body.error.includes(`#${OCCUPYING_MATCH_ID}`));
    assert.equal(body.code, 'server_busy');
    delete process.env.DATHOST_SERVER_ID;
  });

  await test('POST — the in-match player (non-admin) can provision (202), and the deferred call runs', async () => {
    __setTestAfterMode(true);
    const db = installFixture();
    process.env.MATCHZY_CONFIG_SECRET = 'test-secret';
    const res = await call(MATCH_ID, IN_MATCH_ID);
    assert.equal(res.status, 202);
    assert.deepEqual(await res.clone().json(), { ok: true, status: 'provisioning' });

    await __flushTestAfter();
    // No DATHOST_SERVER_ID configured here — provisionMatchServer() fails fast; the deferred call
    // having run (and its failure captured, not left unhandled) is what this asserts.
    assert.ok(db.ops_errors.some((e) => e.entity_id === MATCH_ID && e.operation === 'server_provision'));

    delete process.env.MATCHZY_CONFIG_SECRET;
    __setTestAfterMode(false);
  });

  await test('POST — a scrim match gets its starting side from its lobby choice as it starts', async () => {
    __setTestAfterMode(true);
    process.env.MATCHZY_CONFIG_SECRET = 'test-secret';
    const db = installFixture();
    db.matches = [{ id: MATCH_ID, scrim_night_id: 5, week_id: null, match_number: 1, final_score: null, scrim_side_choice: 'skins_t', skins_starting_side: null }];
    assert.equal((await call(MATCH_ID, IN_MATCH_ID)).status, 202);
    assert.equal(db.matches[0].skins_starting_side, 'T');
    await __flushTestAfter();
    delete process.env.MATCHZY_CONFIG_SECRET;
    __setTestAfterMode(false);
  });

  await test('POST — 409 for a queued scrim match while an earlier one has no score', async () => {
    process.env.MATCHZY_CONFIG_SECRET = 'test-secret';
    const db = installFixture();
    db.matches = [
      { id: 900, scrim_night_id: 5, week_id: null, match_number: 1, final_score: null, scrim_side_choice: 'knife' },
      { id: MATCH_ID, scrim_night_id: 5, week_id: null, match_number: 2, final_score: null, scrim_side_choice: 'random', skins_starting_side: null },
    ];
    const res = await call(MATCH_ID, IN_MATCH_ID);
    assert.equal(res.status, 409);
    assert.equal(db.matches[1].skins_starting_side, null, 'a refused start flips no side');
    db.matches[0].final_score = '13-7';
    __setTestAfterMode(true);
    assert.equal((await call(MATCH_ID, IN_MATCH_ID)).status, 202);
    await __flushTestAfter();
    delete process.env.MATCHZY_CONFIG_SECRET;
    __setTestAfterMode(false);
  });

  await test('POST — a scrim match takes the server from the previous match of its night once that game is over, ignoring its players', async () => {
    process.env.MATCHZY_CONFIG_SECRET = 'test-secret';
    const db = installFixture();
    db.matches = [
      { id: 900, scrim_night_id: 5, week_id: null, match_number: 1, final_score: null, scrim_side_choice: 'knife' },
      { id: MATCH_ID, scrim_night_id: 5, week_id: null, match_number: 2, final_score: null, scrim_side_choice: 'random', skins_starting_side: null },
    ];
    db.match_server_state = [
      { match_id: 900, server_state: 'tearing_down', dathost_server_id: 'srv-1', connect_string: '1.2.3.4:27015', server_started_at: null, teardown_at: new Date(Date.now() + 60_000).toISOString() },
    ];
    const realFetch = globalThis.fetch;
    let stopped = false;
    process.env.DATHOST_SERVER_ID = 'srv-1';
    process.env.DATHOST_EMAIL = 'test@example.com';
    process.env.DATHOST_PASSWORD = 'test';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (target.endsWith('/game-servers/srv-1/stop')) {
        stopped = true;
        return new Response('{}', { status: 200 });
      }
      if (target.endsWith('/game-servers/srv-1') && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ id: 'srv-1', on: true, booting: false, players_online: stopped ? 0 : 5 }), { status: 200 });
      }
      throw new Error('offline');
    }) as typeof fetch;
    __setTestAfterMode(true);
    try {
      assert.equal((await call(MATCH_ID, IN_MATCH_ID)).status, 202);
      assert.equal(stopped, true, 'the finished match\'s server was stopped for it');
      assert.equal(db.match_server_state.find((r) => r.match_id === 900)!.server_state, 'done');
      await __flushTestAfter();
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.DATHOST_SERVER_ID;
      delete process.env.DATHOST_EMAIL;
      delete process.env.DATHOST_PASSWORD;
      delete process.env.MATCHZY_CONFIG_SECRET;
      __setTestAfterMode(false);
    }
  });

  await test('POST — 409 for a scrim match within 30 minutes of a scheduled league match; the league match gets the server', async () => {
    process.env.MATCHZY_CONFIG_SECRET = 'test-secret';
    const db = installFixture();
    const soon = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    db.seasons = [{ id: 4, name: 'Season 4' }];
    db.weeks = [{ id: 40, season_id: 4, week_number: 3 }];
    db.matches = [
      { id: MATCH_ID, scrim_night_id: 5, week_id: null, match_number: 1, final_score: null, scrim_side_choice: 'knife', skins_starting_side: null, scheduled_at: null },
      { id: 500, scrim_night_id: null, week_id: 40, match_number: 2, final_score: null, scheduled_at: soon },
    ];
    const res = await call(MATCH_ID, IN_MATCH_ID);
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { code: string }).code, 'league_match_due');
    db.matches[1].scheduled_at = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    __setTestAfterMode(true);
    assert.equal((await call(MATCH_ID, IN_MATCH_ID)).status, 202);
    await __flushTestAfter();
    delete process.env.MATCHZY_CONFIG_SECRET;
    __setTestAfterMode(false);
  });

  await test('POST — a league match on a server live outside a DGLS match gets a forceable 409', async () => {
    process.env.MATCHZY_CONFIG_SECRET = 'test-secret';
    const db = installFixture();
    db.match_server_state = [];
    await withLiveServer(2, async () => {
      const res = await call(MATCH_ID, IN_MATCH_ID);
      assert.equal(res.status, 409);
      const body = (await res.json()) as { code: string; forceable: boolean; error: string };
      assert.equal(body.code, 'server_occupied');
      assert.equal(body.forceable, true);
      assert.equal(body.error, '2 player(s) are currently on the server outside of a DGLS match. Starting kicks them.');
    });
    await withLiveServer(0, async () => {
      const body = (await (await call(MATCH_ID, IN_MATCH_ID)).json()) as { error: string };
      assert.equal(body.error, 'The server is running outside a DGLS match. Starting restarts it.');
    });
    delete process.env.MATCHZY_CONFIG_SECRET;
  });

  await test('POST — `force` starts the league match anyway: provisioning gets past the live-server guard', async () => {
    __setTestAfterMode(true);
    process.env.MATCHZY_CONFIG_SECRET = 'test-secret';
    const db = installFixture();
    db.match_server_state = [];
    await withLiveServer(2, async () => {
      assert.equal((await call(MATCH_ID, IN_MATCH_ID, { force: true })).status, 202);
      await __flushTestAfter();
    });
    // Past the guard, provisioning claimed the server and then failed on the (offline) boot — a
    // refusal of the live server would have been skipped without claiming or recording anything.
    assert.ok(db.match_server_state.some((r) => r.match_id === MATCH_ID));
    assert.ok(db.ops_errors.some((e) => e.entity_id === MATCH_ID && e.operation === 'server_provision'));
    delete process.env.MATCHZY_CONFIG_SECRET;
    __setTestAfterMode(false);
  });

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
