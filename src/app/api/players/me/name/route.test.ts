/**
 * Route-handler tests for PATCH /api/players/me/name (#268) — the self-service rename: the session
 * gate, name validation, the once-a-week cooldown (a 429 carrying when the next rename opens), a taken
 * name as a 409, and a read or write failure as a 500. A rename that lands starts the cooldown clock and
 * writes a name-history row.
 *
 * Run:  npx vitest run src/app/api/players/me/name/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { __setTestAfterMode } from '@/lib/after';
import { clientFailingOn, createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { PATCH } from './route';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const ELIGIBLE_ID = 1; // never renamed
const STALE_ID = 2; // last renamed long ago
const COOLING_ID = 3; // renamed an hour ago
const MISSING_ID = 99; // a session for a player with no row

// A fresh row set per call — an update mutates its row in place.
function makeDb(): FakeDb {
  const player = (id: number, name: string, name_changed_at: string | null) => ({
    id,
    name,
    name_changed_at,
    discord_name_role_id: null,
  });
  return {
    players: [
      player(ELIGIBLE_ID, 'Alice', null),
      player(STALE_ID, 'Bob', '2020-01-01T00:00:00.000Z'),
      player(COOLING_ID, 'Carol', new Date(Date.now() - 60 * 60 * 1000).toISOString()),
    ],
    player_name_history: [],
    ops_errors: [],
  };
}

function installFixture(wrap?: (client: ReturnType<typeof createFakeSupabaseClient>) => ReturnType<typeof createFakeSupabaseClient>) {
  // A name-role rename runs in after(), which only exists inside a real request.
  __setTestAfterMode(true);
  const db = makeDb();
  const client = createFakeSupabaseClient(db);
  __setTestAdminClient(wrap ? wrap(client) : client);
  return db;
}

function call(sessionPlayerId: number | null, body?: unknown) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return PATCH(jsonRequest('http://localhost/api/players/me/name', 'PATCH', body));
}

const playerRow = (db: FakeDb, id: number) => db.players.find((p) => p.id === id)!;

async function main() {
  await test('PATCH — unauthenticated request is rejected (401)', async () => {
    installFixture();
    assert.equal((await call(null, { name: 'Alicia' })).status, 401);
  });

  await test('PATCH — a missing or invalid name is rejected (400)', async () => {
    const db = installFixture();
    assert.equal((await call(ELIGIBLE_ID)).status, 400);
    assert.equal((await call(ELIGIBLE_ID, {})).status, 400);
    assert.equal((await call(ELIGIBLE_ID, { name: '   ' })).status, 400);
    assert.equal((await call(ELIGIBLE_ID, { name: 7 })).status, 400);
    assert.equal(playerRow(db, ELIGIBLE_ID).name, 'Alice');
  });

  await test('PATCH — a session for a player with no row is a 404', async () => {
    installFixture();
    assert.equal((await call(MISSING_ID, { name: 'Ghost' })).status, 404);
  });

  await test('PATCH — resubmitting the current name succeeds without a write, even mid-cooldown', async () => {
    const db = installFixture();
    const before = playerRow(db, COOLING_ID).name_changed_at;
    const res = await call(COOLING_ID, { name: 'Carol' });
    assert.equal(res.status, 200);
    assert.equal(playerRow(db, COOLING_ID).name_changed_at, before);
    assert.equal(db.player_name_history.length, 0);
  });

  await test('PATCH — a first rename lands, starts the cooldown clock and logs the old name', async () => {
    const db = installFixture();
    const res = await call(ELIGIBLE_ID, { name: 'Alicia' });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).player, { id: ELIGIBLE_ID, name: 'Alicia' });
    const alice = playerRow(db, ELIGIBLE_ID);
    assert.equal(alice.name, 'Alicia');
    assert.ok(alice.name_changed_at);
    assert.deepEqual(
      db.player_name_history.map((r) => ({ player_id: r.player_id, old_name: r.old_name, new_name: r.new_name })),
      [{ player_id: ELIGIBLE_ID, old_name: 'Alice', new_name: 'Alicia' }],
    );
  });

  await test('PATCH — a rename whose last change is older than a week lands', async () => {
    const db = installFixture();
    assert.equal((await call(STALE_ID, { name: 'Robert' })).status, 200);
    assert.equal(playerRow(db, STALE_ID).name, 'Robert');
  });

  await test('PATCH — a second rename inside the week is a 429 naming when the next one opens', async () => {
    const db = installFixture();
    const changedAt = playerRow(db, COOLING_ID).name_changed_at as string;
    const res = await call(COOLING_ID, { name: 'Caroline' });
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.nextEligibleAt, new Date(new Date(changedAt).getTime() + WEEK_MS).toISOString());
    assert.equal(playerRow(db, COOLING_ID).name, 'Carol');
    assert.equal(db.player_name_history.length, 0);
  });

  await test('PATCH — two renames in a row: the second is held by the clock the first started', async () => {
    const db = installFixture();
    assert.equal((await call(STALE_ID, { name: 'Robert' })).status, 200);
    assert.equal((await call(STALE_ID, { name: 'Bobby' })).status, 429);
    assert.equal(playerRow(db, STALE_ID).name, 'Robert');
    assert.equal(db.player_name_history.length, 1);
  });

  await test('PATCH — a unique violation on the write (a taken name) is a 409', async () => {
    const db = installFixture((c) => clientFailingOn(c, 'players', 'update', { code: '23505', message: 'duplicate key' }));
    const res = await call(ELIGIBLE_ID, { name: 'Bob' });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'That name is already taken.');
    assert.equal(playerRow(db, ELIGIBLE_ID).name, 'Alice');
    assert.equal(db.player_name_history.length, 0);
  });

  await test('PATCH — any other write failure is a 500 carrying the database message', async () => {
    const db = installFixture((c) => clientFailingOn(c, 'players', 'update', { code: 'XX000', message: 'connection reset' }));
    const res = await call(ELIGIBLE_ID, { name: 'Alicia' });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, 'connection reset');
    assert.equal(playerRow(db, ELIGIBLE_ID).name, 'Alice');
    assert.equal(db.player_name_history.length, 0);
  });

  await test('PATCH — a failed read of the current row is a 500', async () => {
    installFixture((c) => clientFailingOn(c, 'players', 'select', { code: 'XX000', message: 'select exploded' }));
    const res = await call(ELIGIBLE_ID, { name: 'Alicia' });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, 'select exploded');
  });

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
