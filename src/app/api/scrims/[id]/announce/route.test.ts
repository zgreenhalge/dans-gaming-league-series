/**
 * Route-handler tests for POST /api/scrims/[id]/announce: admin only, an invalid or unknown night is
 * refused, and a night's Discord message is posted by hand — a failed post comes back as an error
 * rather than a thrown 500.
 *
 * Run:  npx vitest run src/app/api/scrims/[id]/announce/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { scrimNightStartingIn } from '@/lib/test-support/scrimFixtures';
import { POST } from './route';

const ADMIN_ID = 1;
const PLAYER_ID = 2;
const NIGHT = '5';
const HOUR = 60 * 60 * 1000;
const WEBHOOK = 'https://discord.example/webhook';

function installFixture(): FakeDb {
  const db: FakeDb = {
    players: [
      { id: ADMIN_ID, name: 'Admin', is_admin: true, discord_name_role_id: null, steam_avatar_url: null },
      { id: PLAYER_ID, name: 'Player', is_admin: false, discord_name_role_id: null, steam_avatar_url: null },
    ],
    scrim_nights: [scrimNightStartingIn(5 * HOUR, Number(NIGHT))],
    scrim_signups: [{ id: 1, night_id: 5, player_id: PLAYER_ID, commitment: 'definite', signed_up_at: '2026-01-01T00:01:00Z', checked_in_at: null }],
    scrim_night_discord_state: [],
    matches: [],
    ops_errors: [],
  };
  __setTestAdminClient(createFakeSupabaseClient(db, { schedule_scrim_night_reminder: () => true, schedule_one_shot_post: () => true }));
  return db;
}

function stubFetch(status: number): void {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () =>
    ({ ok: status < 300, status, json: async () => ({ id: 'msg-1' }) }) as unknown as Response) as typeof fetch;
}

const announce = (id = NIGHT) => POST(new Request(`http://localhost/api/scrims/${id}/announce`, { method: 'POST' }), { params: Promise.resolve({ id }) });

async function main() {
  process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = WEBHOOK;

  await test('an unauthenticated request is 401 and a non-admin 403', async () => {
    installFixture();
    __setTestSession(null);
    assert.equal((await announce()).status, 401);
    __setTestSession(sessionFor(PLAYER_ID));
    assert.equal((await announce()).status, 403);
  });

  await test('an admin posts the announcement and its id is stored', async () => {
    const db = installFixture();
    stubFetch(200);
    __setTestSession(sessionFor(ADMIN_ID));
    const res = await announce();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, posted: 'announcement' });
    assert.equal(db.scrim_night_discord_state[0].announcement_message_id, 'msg-1');
  });

  await test('a refused post is a 502 with the error, and recorded to ops_errors', async () => {
    const db = installFixture();
    stubFetch(500);
    __setTestSession(sessionFor(ADMIN_ID));
    const realError = console.error;
    console.error = () => {};
    try {
      const res = await announce();
      assert.equal(res.status, 502);
      assert.ok(((await res.json()) as { error: string }).error);
    } finally {
      console.error = realError;
    }
    assert.deepEqual(db.ops_errors.map((r) => [r.entity_type, r.entity_id, r.operation]), [['scrim_night', 5, 'scrim_announce']]);
  });

  await test('an invalid id is 400 and an unknown night 404', async () => {
    installFixture();
    stubFetch(200);
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await announce('abc')).status, 400);
    assert.equal((await announce('99')).status, 404);
  });

  report();
}

await main();
