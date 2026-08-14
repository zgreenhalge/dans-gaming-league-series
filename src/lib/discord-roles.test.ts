/**
 * Unit tests for discord-roles.ts's @Participants role sync (#397), including the ops_errors
 * observability retrofit — a real Discord API failure must be visible in the admin console's
 * Activity feed, not just a Vercel function log.
 *
 * Run:  npx vitest run src/lib/discord-roles.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient, type FakeDb, type Row } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import {
  grantParticipantRole,
  revokeParticipantRole,
  grantParticipantRoleToRoster,
  revokeParticipantRoleFromRoster,
  syncParticipantRoleForPlayer,
} from './discord-roles';
import { test, report } from './test-support/miniTest';

// Season 3 ("Season 6") is the fixture's one ACTIVE non-gauntlet season, rostering players 1/2/3
// (Alice/Bob/Carol) — see test-support/fixtures.ts's SEASON_PLAYERS. Player 4 (Dave) is not on it.
const ROSTERED_PLAYER_ID = 1;
const UNROSTERED_PLAYER_ID = 4;

const PLAYER_ID = 1;
const ENV_KEYS = ['DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID', 'DISCORD_PARTICIPANTS_ROLE_ID'] as const;

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function setEnv() {
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  process.env.DISCORD_GUILD_ID = 'test-guild-id';
  process.env.DISCORD_PARTICIPANTS_ROLE_ID = 'test-role-id';
}

interface FetchCall {
  url: string;
  method: string;
}

function stubFetch(status = 204): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    return { ok: status >= 200 && status < 300, status } as Response;
  }) as typeof fetch;
  return { calls };
}

function freshDb(): { db: FakeDb; client: ReturnType<typeof createFakeSupabaseClient> } {
  const db = buildFakeDb();
  const client = createFakeSupabaseClient(db);
  // syncParticipantRoleForPlayer() reads getActiveRegularSeason()/getSeasonRoster() through the
  // query layer's own anon-client singleton, not the explicit `client` param the rest of this file
  // passes around -- both need to point at the same fake db.
  __setTestClient(client);
  return { db, client };
}

function liveOpsErrors(db: FakeDb, playerId: number): Row[] {
  return db.ops_errors.filter(
    (r) => r.entity_type === 'player' && r.entity_id === playerId && r.operation === 'discord_role_sync' && r.dismissed_at === null,
  );
}

async function main() {
  await test('grantParticipantRole: no-ops without discord_id', async () => {
    setEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await grantParticipantRole(client, PLAYER_ID, null);
    assert.equal(calls.length, 0);
  });

  await test('grantParticipantRole: no-ops without full config', async () => {
    clearEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await grantParticipantRole(client, PLAYER_ID, 'user-1');
    assert.equal(calls.length, 0);
  });

  await test('grantParticipantRole: PUTs the guild-member-role endpoint', async () => {
    setEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await grantParticipantRole(client, PLAYER_ID, 'user-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[0].url, 'https://discord.com/api/v10/guilds/test-guild-id/members/user-1/roles/test-role-id');
  });

  await test('revokeParticipantRole: DELETEs the guild-member-role endpoint', async () => {
    setEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await revokeParticipantRole(client, PLAYER_ID, 'user-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'DELETE');
  });

  await test('revokeParticipantRole: no-ops without discord_id', async () => {
    setEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await revokeParticipantRole(client, PLAYER_ID, null);
    assert.equal(calls.length, 0);
  });

  await test('grantParticipantRole: swallows a 404 (not a guild member) without recording an error', async () => {
    setEnv();
    const { db, client } = freshDb();
    stubFetch(404);
    await assert.doesNotReject(() => grantParticipantRole(client, PLAYER_ID, 'user-1'));
    assert.equal(liveOpsErrors(db, PLAYER_ID).length, 0);
  });

  await test('grantParticipantRole: a network error is recorded to ops_errors', async () => {
    setEnv();
    const { db, client } = freshDb();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    await assert.doesNotReject(() => grantParticipantRole(client, PLAYER_ID, 'user-1'));
    const rows = liveOpsErrors(db, PLAYER_ID);
    assert.equal(rows.length, 1);
    assert.match(rows[0].message as string, /network down/);
  });

  await test('grantParticipantRole: a non-ok, non-404 response is recorded to ops_errors', async () => {
    setEnv();
    const { db, client } = freshDb();
    stubFetch(403);
    await grantParticipantRole(client, PLAYER_ID, 'user-1');
    const rows = liveOpsErrors(db, PLAYER_ID);
    assert.equal(rows.length, 1);
    assert.match(rows[0].message as string, /403/);
  });

  await test('a later success clears the prior ops_errors row', async () => {
    setEnv();
    const { db, client } = freshDb();
    stubFetch(403);
    await grantParticipantRole(client, PLAYER_ID, 'user-1');
    assert.equal(liveOpsErrors(db, PLAYER_ID).length, 1, 'precondition: the failed grant left a live error');

    stubFetch(204);
    await grantParticipantRole(client, PLAYER_ID, 'user-1');
    assert.equal(liveOpsErrors(db, PLAYER_ID).length, 0);
  });

  await test('grantParticipantRoleToRoster: one call per linked player, skipping unlinked ones', async () => {
    setEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await grantParticipantRoleToRoster(client, [
      { player_id: 1, discord_id: 'user-1' },
      { player_id: 2, discord_id: null },
      { player_id: 3, discord_id: 'user-2' },
    ]);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((c) => c.url).sort(), [
      'https://discord.com/api/v10/guilds/test-guild-id/members/user-1/roles/test-role-id',
      'https://discord.com/api/v10/guilds/test-guild-id/members/user-2/roles/test-role-id',
    ]);
  });

  await test('revokeParticipantRoleFromRoster: one call per linked player, skipping unlinked ones', async () => {
    setEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await revokeParticipantRoleFromRoster(client, [
      { player_id: 1, discord_id: null },
      { player_id: 2, discord_id: 'user-3' },
    ]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'DELETE');
  });

  await test('syncParticipantRoleForPlayer: grants when the player is on the active season roster', async () => {
    setEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await syncParticipantRoleForPlayer(client, ROSTERED_PLAYER_ID, 'user-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PUT');
  });

  await test('syncParticipantRoleForPlayer: revokes when the player is not on the active season roster', async () => {
    setEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await syncParticipantRoleForPlayer(client, UNROSTERED_PLAYER_ID, 'user-4');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'DELETE');
  });

  await test('syncParticipantRoleForPlayer: no-ops without a discord_id', async () => {
    setEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await syncParticipantRoleForPlayer(client, ROSTERED_PLAYER_ID, null);
    assert.equal(calls.length, 0);
  });

  clearEnv();
  report();
}

await main();
