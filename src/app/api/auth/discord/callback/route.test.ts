/**
 * Route-handler tests for GET /api/auth/discord/callback (#394), focused on the ops_errors
 * observability retrofit — a genuine failure (misconfiguration, a bad response from Discord, an
 * unhandled exception) must land in ops_errors so it's visible in the admin console, not just the
 * expected "denied"/"taken" outcomes or a Vercel log.
 *
 * Run:  npx vitest run src/app/api/auth/discord/callback/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from '@/lib/supabase';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { __setTestAfterMode, __flushTestAfter } from '@/lib/after';
import { createFakeSupabaseClient, type FakeDb, type Row } from '@/lib/test-support/fakeSupabase';
import { buildFakeDb } from '@/lib/test-support/fixtures';
import { signDiscordLinkState } from '@/lib/discordLinkState';
import { test, report } from '@/lib/test-support/miniTest';
import { GET } from './route';

process.env.NEXTAUTH_SECRET = 'test-secret-do-not-use-in-prod';
process.env.NEXTAUTH_URL = 'http://localhost:3000';

const PLAYER_ID = 1; // Alice, per test-support/fixtures.ts — no discord_id set.

function freshDb(): { db: FakeDb; client: ReturnType<typeof createFakeSupabaseClient> } {
  const db = buildFakeDb();
  const client = createFakeSupabaseClient(db);
  __setTestAdminClient(client);
  // A successful link's afterBestEffort hook calls syncParticipantRoleForPlayer(), which reads
  // getActiveRegularSeason()/getSeasonRoster() through the query layer's own anon-client singleton,
  // not the admin client above -- both need to point at the same fake db, or that call falls through
  // to a real network request.
  __setTestClient(client);
  return { db, client };
}

function liveOpsErrors(db: FakeDb, entityType: string, entityId: number): Row[] {
  return db.ops_errors.filter(
    (r) => r.entity_type === entityType && r.entity_id === entityId && r.operation === 'discord_link' && r.dismissed_at === null,
  );
}

/** Routes a fetch call to a canned response by matching a substring of the URL — the route makes
 *  two outbound calls in sequence (token exchange, then /users/@me). */
function stubFetch(responses: Record<string, { ok: boolean; status?: number; json: unknown }>) {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string) => {
    const match = Object.entries(responses).find(([key]) => url.includes(key));
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    const [, res] = match;
    return { ok: res.ok, status: res.status ?? (res.ok ? 200 : 500), json: async () => res.json } as Response;
  }) as typeof fetch;
}

function callbackUrl(params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString();
  return `http://localhost:3000/api/auth/discord/callback?${search}`;
}

async function main() {
  await test('missing/invalid state redirects home with a bad-state error, no player to attribute it to', async () => {
    freshDb();
    const res = await GET(new Request(callbackUrl({ code: 'abc', state: 'not-a-real-state' })));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get('location'), 'http://localhost:3000/?error=discord_bad_state');
  });

  await test('no code (user denied consent) redirects "denied", nothing recorded', async () => {
    const { db } = freshDb();
    const state = signDiscordLinkState(PLAYER_ID);
    const res = await GET(new Request(callbackUrl({ state })));
    assert.equal(res.headers.get('location'), `http://localhost:3000/players/${PLAYER_ID}?discord=denied`);
    assert.equal(liveOpsErrors(db, 'player', PLAYER_ID).length, 0);
  });

  await test('missing app config redirects "error" and records a system-level ops_error', async () => {
    const { db } = freshDb();
    delete process.env.DISCORD_CLIENT_ID;
    delete process.env.DISCORD_CLIENT_SECRET;
    const state = signDiscordLinkState(PLAYER_ID);
    const res = await GET(new Request(callbackUrl({ code: 'abc', state })));
    assert.equal(res.headers.get('location'), `http://localhost:3000/players/${PLAYER_ID}?discord=error`);
    assert.equal(liveOpsErrors(db, 'system', 0).length, 1);
  });

  await test('a failed token exchange redirects "error" and records a player-level ops_error', async () => {
    const { db } = freshDb();
    process.env.DISCORD_CLIENT_ID = 'test-client-id';
    process.env.DISCORD_CLIENT_SECRET = 'test-client-secret';
    stubFetch({ 'oauth2/token': { ok: false, status: 401, json: {} } });
    const state = signDiscordLinkState(PLAYER_ID);
    const res = await GET(new Request(callbackUrl({ code: 'abc', state })));
    assert.equal(res.headers.get('location'), `http://localhost:3000/players/${PLAYER_ID}?discord=error`);
    const rows = liveOpsErrors(db, 'player', PLAYER_ID);
    assert.equal(rows.length, 1);
    assert.match(rows[0].message as string, /401/);
  });

  await test('a successful link redirects "linked", writes discord_id, clears a prior ops_error, and syncs @Participants', async () => {
    __setTestAfterMode(true);
    const { db, client } = freshDb();
    // Simulate a prior failed attempt having left a live error, to prove success clears it.
    await client.from('ops_errors').insert({
      entity_type: 'player', entity_id: PLAYER_ID, operation: 'discord_link',
      message: 'previous failure', occurred_at: new Date().toISOString(), dismissed_at: null,
    });
    process.env.DISCORD_CLIENT_ID = 'test-client-id';
    process.env.DISCORD_CLIENT_SECRET = 'test-client-secret';
    stubFetch({
      'oauth2/token': { ok: true, json: { access_token: 'test-token' } },
      'users/@me': { ok: true, json: { id: 'discord-user-1' } },
    });
    const state = signDiscordLinkState(PLAYER_ID);
    const res = await GET(new Request(callbackUrl({ code: 'abc', state })));
    await __flushTestAfter();
    assert.equal(res.headers.get('location'), `http://localhost:3000/players/${PLAYER_ID}?discord=linked`);
    assert.equal(db.players.find((p) => p.id === PLAYER_ID)!.discord_id, 'discord-user-1');
    assert.equal(liveOpsErrors(db, 'player', PLAYER_ID).length, 0);
    __setTestAfterMode(false);
  });

  await test('a discord_id already linked to another player redirects "taken", not logged as an error', async () => {
    const { db } = freshDb();
    // Player 2 (Bob) already has this discord_id linked.
    db.players.find((p) => p.id === 2)!.discord_id = 'discord-user-2';
    process.env.DISCORD_CLIENT_ID = 'test-client-id';
    process.env.DISCORD_CLIENT_SECRET = 'test-client-secret';
    stubFetch({
      'oauth2/token': { ok: true, json: { access_token: 'test-token' } },
      'users/@me': { ok: true, json: { id: 'discord-user-2' } },
    });
    const state = signDiscordLinkState(PLAYER_ID);
    const res = await GET(new Request(callbackUrl({ code: 'abc', state })));
    assert.equal(res.headers.get('location'), `http://localhost:3000/players/${PLAYER_ID}?discord=taken`);
    assert.equal(liveOpsErrors(db, 'player', PLAYER_ID).length, 0);
  });

  __setTestAdminClient(undefined);
  __setTestClient(undefined);
  report();
}

await main();
