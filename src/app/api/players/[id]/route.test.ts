/**
 * Route-handler tests for PATCH /api/players/[id] (#144, #394) — admin player management: the
 * admin gate, each body validation, the single multi-field `players` update (name, is_admin,
 * steam_id, discord_id, seed_ehog), the name-history audit row a rename writes, the 409s for a taken
 * Steam id / Discord id / name, and a write failure as a 500.
 *
 * Run:  npx vitest run "src/app/api/players/[id]/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { __setTestAfterMode } from '@/lib/after';
import { clientFailingOn, createFakeSupabaseClient, type FakeDb, type Row } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, MALFORMED_ROUTE_IDS, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { PATCH } from './route';

const ADMIN_ID = 1;
const BOB_ID = 2;
const CAROL_ID = 3;
const MISSING_ID = 99;

const STEAM_A = '76500000000000001';
const STEAM_B = '76500000000000002';
const DISCORD_A = '100000000000000001';
const DISCORD_B = '100000000000000002';

// A fresh row set per call — an update mutates its row in place, so a shared fixture would leak
// one test's write into the next.
function makeDb(): FakeDb {
  const player = (id: number, name: string, extra: Row = {}): Row => ({
    id,
    name,
    is_admin: false,
    steam_id: null,
    steam_nickname: null,
    steam_avatar_url: null,
    steam_refreshed_at: null,
    discord_id: null,
    discord_name_role_id: null,
    seed_ehog: null,
    name_changed_at: null,
    ...extra,
  });
  return {
    players: [
      player(ADMIN_ID, 'Alice', { is_admin: true, steam_id: STEAM_A, discord_id: DISCORD_A }),
      player(BOB_ID, 'Bob', { steam_id: STEAM_B, steam_nickname: 'bob_cs', discord_id: DISCORD_B }),
      player(CAROL_ID, 'Carol'),
    ],
    player_name_history: [],
    ops_errors: [],
  };
}

function installFixture(wrap?: (client: ReturnType<typeof createFakeSupabaseClient>) => ReturnType<typeof createFakeSupabaseClient>) {
  // The discord role side effects run in after(), which only exists inside a real request.
  __setTestAfterMode(true);
  const db = makeDb();
  const client = createFakeSupabaseClient(db);
  __setTestAdminClient(wrap ? wrap(client) : client);
  return db;
}

const url = (id: number | string) => `http://localhost/api/players/${id}`;

function call(id: number | string, sessionPlayerId: number | null, body?: unknown) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return PATCH(jsonRequest(url(id), 'PATCH', body), { params: Promise.resolve({ id: String(id) }) });
}

const playerRow = (db: FakeDb, id: number) => db.players.find((p) => p.id === id)!;

async function main() {
  await test('PATCH — unauthenticated request is rejected (401)', async () => {
    installFixture();
    assert.equal((await call(BOB_ID, null, { name: 'Robert' })).status, 401);
  });

  await test('PATCH — a non-admin is rejected (403) and nothing is written', async () => {
    const db = installFixture();
    assert.equal((await call(BOB_ID, CAROL_ID, { name: 'Robert' })).status, 403);
    assert.equal(playerRow(db, BOB_ID).name, 'Bob');
  });

  await test('PATCH — a malformed player id is rejected (400)', async () => {
    installFixture();
    for (const bad of MALFORMED_ROUTE_IDS) {
      assert.equal((await call(bad, ADMIN_ID, { name: 'Robert' })).status, 400, `id ${JSON.stringify(bad)}`);
    }
  });

  await test('PATCH — a missing or non-object body is rejected (400)', async () => {
    installFixture();
    assert.equal((await call(BOB_ID, ADMIN_ID)).status, 400);
    assert.equal((await call(BOB_ID, ADMIN_ID, null)).status, 400);
  });

  await test('PATCH — an empty body is rejected (400, nothing to update)', async () => {
    installFixture();
    const res = await call(BOB_ID, ADMIN_ID, {});
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Nothing to update');
  });

  await test('PATCH — an invalid name is rejected (400)', async () => {
    const db = installFixture();
    assert.equal((await call(BOB_ID, ADMIN_ID, { name: '   ' })).status, 400);
    assert.equal((await call(BOB_ID, ADMIN_ID, { name: 42 })).status, 400);
    assert.equal(playerRow(db, BOB_ID).name, 'Bob');
  });

  await test('PATCH — a rename updates the name, starts the cooldown clock and logs the old name', async () => {
    const db = installFixture();
    const res = await call(BOB_ID, ADMIN_ID, { name: 'Robert' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).player.name, 'Robert');
    assert.equal(playerRow(db, BOB_ID).name, 'Robert');
    assert.ok(playerRow(db, BOB_ID).name_changed_at, 'an admin rename counts toward the self-service cooldown');
    assert.deepEqual(
      db.player_name_history.map((r) => ({ player_id: r.player_id, old_name: r.old_name, new_name: r.new_name })),
      [{ player_id: BOB_ID, old_name: 'Bob', new_name: 'Robert' }],
    );
  });

  await test('PATCH — resubmitting the current name writes no history and leaves the cooldown clock alone', async () => {
    const db = installFixture();
    const res = await call(BOB_ID, ADMIN_ID, { name: 'Bob' });
    assert.equal(res.status, 200);
    assert.equal(db.player_name_history.length, 0);
    assert.equal(playerRow(db, BOB_ID).name_changed_at, null);
  });

  await test('PATCH — is_admin must be a boolean (400)', async () => {
    const db = installFixture();
    assert.equal((await call(BOB_ID, ADMIN_ID, { is_admin: 'yes' })).status, 400);
    assert.equal(playerRow(db, BOB_ID).is_admin, false);
  });

  await test('PATCH — an admin cannot remove their own admin access (400)', async () => {
    const db = installFixture();
    assert.equal((await call(ADMIN_ID, ADMIN_ID, { is_admin: false })).status, 400);
    assert.equal(playerRow(db, ADMIN_ID).is_admin, true);
  });

  await test('PATCH — an admin can promote another player, and demote them again', async () => {
    const db = installFixture();
    assert.equal((await call(BOB_ID, ADMIN_ID, { is_admin: true })).status, 200);
    assert.equal(playerRow(db, BOB_ID).is_admin, true);
    assert.equal((await call(BOB_ID, ADMIN_ID, { is_admin: false })).status, 200);
    assert.equal(playerRow(db, BOB_ID).is_admin, false);
  });

  await test('PATCH — steam_id must be null or a 17-digit SteamID64 (400)', async () => {
    const db = installFixture();
    for (const bad of ['123', 'abcdefghijklmnopq', 76500000000000003, undefined]) {
      assert.equal((await call(CAROL_ID, ADMIN_ID, { steam_id: bad })).status, 400, `steam_id ${String(bad)}`);
    }
    assert.equal(playerRow(db, CAROL_ID).steam_id, null);
  });

  await test('PATCH — a Steam id already linked to another player is rejected (409)', async () => {
    const db = installFixture();
    const res = await call(CAROL_ID, ADMIN_ID, { steam_id: STEAM_B });
    assert.equal(res.status, 409);
    assert.equal(playerRow(db, CAROL_ID).steam_id, null);
  });

  await test('PATCH — setting a Steam id clears the cached nickname, avatar and refresh time', async () => {
    const db = installFixture();
    const res = await call(BOB_ID, ADMIN_ID, { steam_id: '76500000000000009' });
    assert.equal(res.status, 200);
    const bob = playerRow(db, BOB_ID);
    assert.equal(bob.steam_id, '76500000000000009');
    assert.equal(bob.steam_nickname, null);
    assert.equal(bob.steam_refreshed_at, null);
  });

  await test('PATCH — re-submitting a player\'s own Steam id is not a clash', async () => {
    installFixture();
    assert.equal((await call(BOB_ID, ADMIN_ID, { steam_id: STEAM_B })).status, 200);
  });

  await test('PATCH — a null steam_id unlinks and clears the cached Steam profile', async () => {
    const db = installFixture();
    assert.equal((await call(BOB_ID, ADMIN_ID, { steam_id: null })).status, 200);
    const bob = playerRow(db, BOB_ID);
    assert.equal(bob.steam_id, null);
    assert.equal(bob.steam_nickname, null);
  });

  await test('PATCH — discord_id must be null or a 17-20 digit snowflake (400)', async () => {
    const db = installFixture();
    for (const bad of ['123', 'not-a-snowflake', 100000000000000003, undefined]) {
      assert.equal((await call(CAROL_ID, ADMIN_ID, { discord_id: bad })).status, 400, `discord_id ${String(bad)}`);
    }
    assert.equal(playerRow(db, CAROL_ID).discord_id, null);
  });

  await test('PATCH — a Discord id already linked to another player is rejected (409)', async () => {
    const db = installFixture();
    const res = await call(CAROL_ID, ADMIN_ID, { discord_id: DISCORD_B });
    assert.equal(res.status, 409);
    assert.equal(playerRow(db, CAROL_ID).discord_id, null);
  });

  await test('PATCH — linking a Discord id writes it', async () => {
    const db = installFixture();
    const res = await call(CAROL_ID, ADMIN_ID, { discord_id: '100000000000000003' });
    assert.equal(res.status, 200);
    assert.equal(playerRow(db, CAROL_ID).discord_id, '100000000000000003');
  });

  await test('PATCH — a null discord_id unlinks and clears the name-role id', async () => {
    const db = installFixture();
    playerRow(db, BOB_ID).discord_name_role_id = 'role-1';
    assert.equal((await call(BOB_ID, ADMIN_ID, { discord_id: null })).status, 200);
    const bob = playerRow(db, BOB_ID);
    assert.equal(bob.discord_id, null);
    assert.equal(bob.discord_name_role_id, null);
  });

  await test('PATCH — a failed name-role read on unlink is a 500 and nothing is written', async () => {
    // Only the name-role read fails — the admin gate's own players read has to succeed first.
    const db = installFixture((c) =>
      clientFailingOn(c, 'players', 'select', { code: 'XX000', message: 'read failed' }, (cols) => cols === 'discord_name_role_id'),
    );
    playerRow(db, BOB_ID).discord_name_role_id = 'role-1';
    const res = await call(BOB_ID, ADMIN_ID, { discord_id: null });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, 'read failed');
    assert.equal(playerRow(db, BOB_ID).discord_id, DISCORD_B);
    assert.equal(playerRow(db, BOB_ID).discord_name_role_id, 'role-1');
  });

  await test('PATCH — seed_ehog must be null or strictly between 10 and 100 (400)', async () => {
    const db = installFixture();
    for (const bad of [10, 100, 5, 250, '50', undefined]) {
      assert.equal((await call(BOB_ID, ADMIN_ID, { seed_ehog: bad })).status, 400, `seed_ehog ${String(bad)}`);
    }
    assert.equal(playerRow(db, BOB_ID).seed_ehog, null);
  });

  await test('PATCH — seed_ehog sets and clears', async () => {
    const db = installFixture();
    assert.equal((await call(BOB_ID, ADMIN_ID, { seed_ehog: 42.5 })).status, 200);
    assert.equal(playerRow(db, BOB_ID).seed_ehog, 42.5);
    assert.equal((await call(BOB_ID, ADMIN_ID, { seed_ehog: null })).status, 200);
    assert.equal(playerRow(db, BOB_ID).seed_ehog, null);
  });

  await test('PATCH — several fields land in one update', async () => {
    const db = installFixture();
    const res = await call(CAROL_ID, ADMIN_ID, { name: 'Caroline', is_admin: true, seed_ehog: 30 });
    assert.equal(res.status, 200);
    const carol = playerRow(db, CAROL_ID);
    assert.equal(carol.name, 'Caroline');
    assert.equal(carol.is_admin, true);
    assert.equal(carol.seed_ehog, 30);
  });

  await test('PATCH — an unknown player is a 404', async () => {
    installFixture();
    assert.equal((await call(MISSING_ID, ADMIN_ID, { is_admin: true })).status, 404);
  });

  await test('PATCH — a unique violation on the write (a name or id taken after the pre-checks) is a 409', async () => {
    const db = installFixture((c) => clientFailingOn(c, 'players', 'update', { code: '23505', message: 'duplicate key' }));
    const res = await call(BOB_ID, ADMIN_ID, { name: 'Robert' });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /already in use/);
    assert.equal(playerRow(db, BOB_ID).name, 'Bob');
    assert.equal(db.player_name_history.length, 0, 'no history row for a rename that did not land');
  });

  await test('PATCH — any other write failure is a 500 carrying the database message', async () => {
    const db = installFixture((c) => clientFailingOn(c, 'players', 'update', { code: 'XX000', message: 'connection reset' }));
    const res = await call(BOB_ID, ADMIN_ID, { name: 'Robert' });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, 'connection reset');
    assert.equal(playerRow(db, BOB_ID).name, 'Bob');
    assert.equal(db.player_name_history.length, 0);
  });

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
