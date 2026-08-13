/**
 * Coverage for the scrim_sessions singleton row: claimScrimSession()/releaseScrimSession()/
 * reconcileScrimSession() and the warning-threshold helpers (markScrimWarned()/isScrimWarned()).
 *
 * claimScrimSession()'s race-safety depends on the DB rejecting a duplicate-primary-key insert with
 * a 23505 error — see fakeSupabase.ts's header comment for why that's the one constraint this fake
 * emulates.
 *
 * Run:  npx tsx src/lib/scrim-session.test.ts
 */

import assert from 'node:assert/strict';
import { createFakeSupabaseClient, type FakeDb } from './test-support/fakeSupabase';
import { test, report } from './test-support/miniTest';
import {
  claimScrimSession,
  releaseScrimSession,
  getScrimSession,
  markScrimWarned,
  isScrimWarned,
  reconcileScrimSession,
  type ScrimSession,
} from './scrim-session';
import type { DathostServer } from './dathost';

function makeDb(): FakeDb {
  return {
    players: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ],
    scrim_sessions: [],
  };
}

function session(overrides: Partial<ScrimSession> = {}): ScrimSession {
  return { startedBy: 1, startedByName: 'Alice', warned15: false, warned10: false, warned5: false, ...overrides };
}

async function main() {
  await test('claimScrimSession: an empty singleton is claimed successfully', async () => {
    const db = makeDb();
    const client = createFakeSupabaseClient(db);
    const result = await claimScrimSession(client as never, 1);
    // claimScrimSession()'s own insert only sets id/started_by, relying on the real schema's
    // warned_15/10/5 DEFAULT false — this fake doesn't emulate column defaults (see fakeSupabase.ts's
    // header comment), so only the fields the insert itself controls are asserted here.
    assert.equal(result?.startedBy, 1);
    assert.equal(result?.startedByName, 'Alice');
    assert.deepEqual(db.scrim_sessions.map((r) => ({ id: r.id, started_by: r.started_by })), [{ id: 1, started_by: 1 }]);
  });

  await test('claimScrimSession: a race loser (row already claimed) gets null, not an error', async () => {
    const db = makeDb();
    db.scrim_sessions.push({ id: 1, started_by: 1, warned_15: false, warned_10: false, warned_5: false });
    const client = createFakeSupabaseClient(db);
    const result = await claimScrimSession(client as never, 2);
    assert.equal(result, null);
    // The winner's row must survive untouched.
    assert.equal(db.scrim_sessions.length, 1);
    assert.equal(db.scrim_sessions[0].started_by, 1);
  });

  await test('getScrimSession: null when no session is active', async () => {
    const db = makeDb();
    const client = createFakeSupabaseClient(db);
    assert.equal(await getScrimSession(client as never), null);
  });

  await test('getScrimSession: joins the starter\'s name from players', async () => {
    const db = makeDb();
    db.scrim_sessions.push({ id: 1, started_by: 2, warned_15: true, warned_10: false, warned_5: false });
    const client = createFakeSupabaseClient(db);
    assert.deepEqual(await getScrimSession(client as never), session({ startedBy: 2, startedByName: 'Bob', warned15: true }));
  });

  await test('releaseScrimSession: deletes the row; idempotent when already absent', async () => {
    const db = makeDb();
    db.scrim_sessions.push({ id: 1, started_by: 1, warned_15: false, warned_10: false, warned_5: false });
    const client = createFakeSupabaseClient(db);
    await releaseScrimSession(client as never);
    assert.equal(db.scrim_sessions.length, 0);
    await releaseScrimSession(client as never); // no throw
    assert.equal(db.scrim_sessions.length, 0);
  });

  await test('markScrimWarned: sets exactly the column for the given threshold', async () => {
    const db = makeDb();
    db.scrim_sessions.push({ id: 1, started_by: 1, warned_15: false, warned_10: false, warned_5: false });
    const client = createFakeSupabaseClient(db);
    await markScrimWarned(client as never, 10);
    assert.deepEqual(
      { w15: db.scrim_sessions[0].warned_15, w10: db.scrim_sessions[0].warned_10, w5: db.scrim_sessions[0].warned_5 },
      { w15: false, w10: true, w5: false },
    );
  });

  await test('isScrimWarned: reads the threshold-appropriate field', () => {
    const s = session({ warned15: true, warned10: false, warned5: true });
    assert.equal(isScrimWarned(s, 15), true);
    assert.equal(isScrimWarned(s, 10), false);
    assert.equal(isScrimWarned(s, 5), true);
  });

  await test('reconcileScrimSession: null when no session is active, regardless of server state', async () => {
    const db = makeDb();
    const client = createFakeSupabaseClient(db);
    assert.equal(await reconcileScrimSession(client as never, null), null);
  });

  await test('reconcileScrimSession: an active session survives while the server is live', async () => {
    const db = makeDb();
    db.scrim_sessions.push({ id: 1, started_by: 1, warned_15: false, warned_10: false, warned_5: false });
    const client = createFakeSupabaseClient(db);
    const server = { on: true, booting: false } as unknown as DathostServer;
    const result = await reconcileScrimSession(client as never, server);
    assert.deepEqual(result, session());
    assert.equal(db.scrim_sessions.length, 1, 'the row must not be cleared while the server is actually live');
  });

  await test('reconcileScrimSession: a stale session (server not live) is cleared and reported as none', async () => {
    const db = makeDb();
    db.scrim_sessions.push({ id: 1, started_by: 1, warned_15: false, warned_10: false, warned_5: false });
    const client = createFakeSupabaseClient(db);
    const result = await reconcileScrimSession(client as never, null); // server stopped some other way
    assert.equal(result, null);
    assert.equal(db.scrim_sessions.length, 0);
  });

  await test('reconcileScrimSession: a server still booting doesn\'t count as live yet — cleared', async () => {
    // isServerLive() requires `on && !booting` — a still-booting server (matching a scrim that was
    // just started elsewhere and hasn't come up yet) isn't "live" by that definition, so this session
    // gets swept the same as a fully-stopped one. reconcileScrimSession() only protects a session
    // whose server has actually finished booting.
    const db = makeDb();
    db.scrim_sessions.push({ id: 1, started_by: 1, warned_15: false, warned_10: false, warned_5: false });
    const client = createFakeSupabaseClient(db);
    const server = { on: true, booting: true } as unknown as DathostServer;
    const result = await reconcileScrimSession(client as never, server);
    assert.equal(result, null);
    assert.equal(db.scrim_sessions.length, 0);
  });

  report();
}

main();
