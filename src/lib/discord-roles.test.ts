/**
 * Unit tests for discord-roles.ts's @Participants role sync (#397) and its name-color role lifecycle
 * (create/rename/delete/color/backfill), including the ops_errors observability retrofit — a real
 * Discord API failure must be visible in the admin console's Activity feed, not just a Vercel
 * function log.
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
  createNameRole,
  renameNameRole,
  deleteNameRole,
  setDiscordRoleColor,
  backfillNameRoles,
} from './discord-roles';
import { test, report } from './test-support/miniTest';

// Season 3 ("Season 6") is the fixture's one ACTIVE non-gauntlet season, rostering players 1/2/3
// (Alice/Bob/Carol) — see test-support/fixtures.ts's SEASON_PLAYERS. Player 4 (Dave) is not on it.
const ROSTERED_PLAYER_ID = 1;
const UNROSTERED_PLAYER_ID = 4;
// Player 5 (Erin) has no season_players row for season 3, but is already rostered into match 400
// (week 13, season 3's own zero-stat placeholder rows) — the shape of a season scheduled/imported
// without ever writing season_players, which is what #397's bug report turned out to be (see
// discord-roles.ts's getSeasonParticipants() usage).
const MATCH_ROSTERED_ONLY_PLAYER_ID = 5;

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
  body?: unknown;
}

function stubFetch(status = 204): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
    return { ok: status >= 200 && status < 300, status } as Response;
  }) as typeof fetch;
  return { calls };
}

/** Like `stubFetch()`, but returns a different response for each successive call (holding the last
 *  one for any call beyond the list) — for exercising the name-role functions' multi-request
 *  sequences (create → resolve the bot's top role position → reposition → assign). */
function stubFetchSequence(responses: { status: number; json?: unknown }[]): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let i = 0;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json ?? {} } as unknown as Response;
  }) as typeof fetch;
  return { calls };
}

function freshDb(): { db: FakeDb; client: ReturnType<typeof createFakeSupabaseClient> } {
  // buildFakeDb() returns the shared fixture arrays by reference, not copies -- a deep clone here is
  // what makes each test's mutations (e.g. setting a player's discord_id/discord_name_role_id) local
  // to that test instead of leaking into every later test in this file.
  const db = structuredClone(buildFakeDb());
  const client = createFakeSupabaseClient(db);
  // syncParticipantRoleForPlayer() reads getActiveRegularSeason()/getSeasonRoster() through the
  // query layer's own anon-client singleton, not the explicit `client` param the rest of this file
  // passes around -- both need to point at the same fake db.
  __setTestClient(client);
  return { db, client };
}

function liveOpsErrors(db: FakeDb, playerId: number, operation = 'discord_role_sync'): Row[] {
  return db.ops_errors.filter(
    (r) => r.entity_type === 'player' && r.entity_id === playerId && r.operation === operation && r.dismissed_at === null,
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

  await test('syncParticipantRoleForPlayer: grants when the player is only rostered via a match, not season_players', async () => {
    setEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await syncParticipantRoleForPlayer(client, MATCH_ROSTERED_ONLY_PLAYER_ID, 'user-5');
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

  // ─── createNameRole ────────────────────────────────────────────────────────

  await test('createNameRole: no-ops without a discordId', async () => {
    setEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await createNameRole(client, PLAYER_ID, null, 'Alice');
    assert.equal(calls.length, 0);
  });

  await test('createNameRole: no-ops without full config', async () => {
    clearEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await createNameRole(client, PLAYER_ID, 'user-1', 'Alice');
    assert.equal(calls.length, 0);
  });

  await test('createNameRole: no-ops (idempotent) if the player already has a role recorded', async () => {
    setEnv();
    const { db, client } = freshDb();
    db.players.find((p) => p.id === PLAYER_ID)!.discord_name_role_id = 'existing-role';
    const { calls } = stubFetch();
    await createNameRole(client, PLAYER_ID, 'user-1', 'Alice');
    assert.equal(calls.length, 0);
  });

  await test('createNameRole: creates, positions below the bot, assigns, and stores the role id', async () => {
    setEnv();
    const { db, client } = freshDb();
    const { calls } = stubFetchSequence([
      { status: 201, json: { id: 'role-1' } }, // POST create
      { status: 200, json: { id: 'bot-1' } }, // GET @me
      { status: 200, json: { roles: ['bot-role-a'] } }, // GET member
      { status: 200, json: [{ id: 'bot-role-a', position: 5 }, { id: 'other', position: 2 }] }, // GET roles
      { status: 200, json: [] }, // PATCH reposition
      { status: 204 }, // PUT assign
    ]);
    await createNameRole(client, PLAYER_ID, 'user-1', 'Alice');

    assert.equal(calls.length, 6);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, 'https://discord.com/api/v10/guilds/test-guild-id/roles');
    assert.deepEqual(calls[0].body, { name: 'Alice', mentionable: true });
    assert.equal(calls[4].method, 'PATCH');
    assert.deepEqual(calls[4].body, [{ id: 'role-1', position: 4 }]);
    assert.equal(calls[5].method, 'PUT');
    assert.equal(calls[5].url, 'https://discord.com/api/v10/guilds/test-guild-id/members/user-1/roles/role-1');

    const player = db.players.find((p) => p.id === PLAYER_ID);
    assert.equal(player?.discord_name_role_id, 'role-1');
    assert.equal(liveOpsErrors(db, PLAYER_ID, 'discord_name_role_sync').length, 0);
  });

  await test('createNameRole: a failed create is recorded to ops_errors and stores nothing', async () => {
    setEnv();
    const { db, client } = freshDb();
    stubFetchSequence([{ status: 403 }]);
    await createNameRole(client, PLAYER_ID, 'user-1', 'Alice');
    const player = db.players.find((p) => p.id === PLAYER_ID);
    assert.equal(player?.discord_name_role_id, null);
    assert.equal(liveOpsErrors(db, PLAYER_ID, 'discord_name_role_sync').length, 1);
  });

  await test('createNameRole: a 404 on create is a real failure, not a tolerated no-op', async () => {
    // Unlike rename/delete/assign (where a 404 means the target is already gone -- not worth
    // surfacing), a 404 creating a role means something is actually broken (e.g. a bad guild id) --
    // it must be recorded, not silently treated as success with an undefined role id.
    setEnv();
    const { db, client } = freshDb();
    const { calls } = stubFetchSequence([{ status: 404 }]);
    await createNameRole(client, PLAYER_ID, 'user-1', 'Alice');
    assert.equal(calls.length, 1, 'must stop at the failed create, not proceed to reposition/assign');
    const player = db.players.find((p) => p.id === PLAYER_ID);
    assert.equal(player?.discord_name_role_id, null);
    assert.equal(liveOpsErrors(db, PLAYER_ID, 'discord_name_role_sync').length, 1);
  });

  await test('createNameRole: a failed assign (position lookup itself failing) is recorded and stores nothing', async () => {
    setEnv();
    const { db, client } = freshDb();
    const { calls } = stubFetchSequence([
      { status: 201, json: { id: 'role-1' } }, // POST create
      { status: 404 }, // GET @me fails -> position lookup gives up, reposition skipped
      { status: 403 }, // PUT assign fails
    ]);
    await createNameRole(client, PLAYER_ID, 'user-1', 'Alice');
    assert.equal(calls.length, 3, 'reposition should be skipped once the position lookup fails');
    const player = db.players.find((p) => p.id === PLAYER_ID);
    assert.equal(player?.discord_name_role_id, null);
    assert.equal(liveOpsErrors(db, PLAYER_ID, 'discord_name_role_sync').length, 1);
  });

  // ─── renameNameRole ────────────────────────────────────────────────────────

  await test('renameNameRole: no-ops without a roleId', async () => {
    setEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await renameNameRole(client, PLAYER_ID, null, 'New Name');
    assert.equal(calls.length, 0);
  });

  await test('renameNameRole: no-ops without full config', async () => {
    clearEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await renameNameRole(client, PLAYER_ID, 'role-1', 'New Name');
    assert.equal(calls.length, 0);
  });

  await test('renameNameRole: PATCHes the role with the new name', async () => {
    setEnv();
    const { db, client } = freshDb();
    const { calls } = stubFetch(200);
    await renameNameRole(client, PLAYER_ID, 'role-1', 'New Name');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(calls[0].url, 'https://discord.com/api/v10/guilds/test-guild-id/roles/role-1');
    assert.equal(liveOpsErrors(db, PLAYER_ID, 'discord_name_role_sync').length, 0);
  });

  await test('renameNameRole: swallows a 404 (role already gone) without recording an error', async () => {
    setEnv();
    const { db, client } = freshDb();
    stubFetch(404);
    await renameNameRole(client, PLAYER_ID, 'role-1', 'New Name');
    assert.equal(liveOpsErrors(db, PLAYER_ID, 'discord_name_role_sync').length, 0);
  });

  await test('renameNameRole: a non-ok, non-404 response is recorded to ops_errors', async () => {
    setEnv();
    const { db, client } = freshDb();
    stubFetch(403);
    await renameNameRole(client, PLAYER_ID, 'role-1', 'New Name');
    assert.equal(liveOpsErrors(db, PLAYER_ID, 'discord_name_role_sync').length, 1);
  });

  // ─── deleteNameRole ────────────────────────────────────────────────────────

  await test('deleteNameRole: no-ops without a roleId', async () => {
    setEnv();
    const { client } = freshDb();
    const { calls } = stubFetch();
    await deleteNameRole(client, PLAYER_ID, null);
    assert.equal(calls.length, 0);
  });

  await test('deleteNameRole: DELETEs the role', async () => {
    setEnv();
    const { db, client } = freshDb();
    const { calls } = stubFetch(204);
    await deleteNameRole(client, PLAYER_ID, 'role-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'DELETE');
    assert.equal(calls[0].url, 'https://discord.com/api/v10/guilds/test-guild-id/roles/role-1');
    assert.equal(liveOpsErrors(db, PLAYER_ID, 'discord_name_role_sync').length, 0);
  });

  await test('deleteNameRole: swallows a 404 (already gone) without recording an error', async () => {
    setEnv();
    const { db, client } = freshDb();
    stubFetch(404);
    await deleteNameRole(client, PLAYER_ID, 'role-1');
    assert.equal(liveOpsErrors(db, PLAYER_ID, 'discord_name_role_sync').length, 0);
  });

  await test('deleteNameRole: a non-ok, non-404 response is recorded to ops_errors', async () => {
    setEnv();
    const { db, client } = freshDb();
    stubFetch(500);
    await deleteNameRole(client, PLAYER_ID, 'role-1');
    assert.equal(liveOpsErrors(db, PLAYER_ID, 'discord_name_role_sync').length, 1);
  });

  // ─── setDiscordRoleColor ───────────────────────────────────────────────────

  await test('setDiscordRoleColor: reports not-configured without full config', async () => {
    clearEnv();
    const { calls } = stubFetch();
    const result = await setDiscordRoleColor('role-1', 0xff5733);
    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
  });

  await test('setDiscordRoleColor: PATCHes the role color', async () => {
    setEnv();
    const { calls } = stubFetch(200);
    const result = await setDiscordRoleColor('role-1', 0xff5733);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PATCH');
    assert.deepEqual(calls[0].body, { color: 0xff5733 });
  });

  await test('setDiscordRoleColor: surfaces a non-ok Discord response as an error result', async () => {
    setEnv();
    stubFetch(403);
    const result = await setDiscordRoleColor('role-1', 0xff5733);
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /403/);
  });

  // ─── backfillNameRoles ─────────────────────────────────────────────────────

  await test('backfillNameRoles: only attempts linked players still missing a role', async () => {
    // Config left unset so createNameRole() no-ops per player, isolating the selection query itself.
    clearEnv();
    const { db, client } = freshDb();
    db.players.find((p) => p.id === 1)!.discord_id = 'user-1'; // linked, no role -> selected
    const bob = db.players.find((p) => p.id === 2)!;
    bob.discord_id = 'user-2';
    bob.discord_name_role_id = 'role-existing'; // linked, already has a role -> skipped
    db.players.find((p) => p.id === 3)!.discord_id = null; // unlinked -> skipped

    const result = await backfillNameRoles(client);
    assert.equal(result.attempted, 1);
  });

  await test('backfillNameRoles: processes players sequentially, not concurrently', async () => {
    // Regression test: Promise.all()-ing createNameRole() across a batch that shares one
    // precomputed topPosition races each player's reposition PATCH for the same target slot --
    // Discord resolves each request against whatever order already exists with no visibility into
    // the others in flight, so the final order depends on network timing instead of every role
    // landing directly under the bot. Sequential processing is what makes that deterministic.
    setEnv();
    const { db, client } = freshDb();
    db.players.find((p) => p.id === 1)!.discord_id = 'user-1';
    db.players.find((p) => p.id === 2)!.discord_id = 'user-2';
    const { calls } = stubFetchSequence([
      { status: 200, json: { id: 'bot-1' } }, // GET @me (topPosition resolved once for the batch)
      { status: 200, json: { roles: ['bot-role-a'] } }, // GET member
      { status: 200, json: [{ id: 'bot-role-a', position: 5 }] }, // GET roles
      { status: 201, json: { id: 'role-1' } }, // player 1: create
      { status: 200 }, // player 1: reposition
      { status: 204 }, // player 1: assign
      { status: 201, json: { id: 'role-2' } }, // player 2: create
      { status: 200 }, // player 2: reposition
      { status: 204 }, // player 2: assign
    ]);
    const result = await backfillNameRoles(client);
    assert.equal(result.attempted, 2);
    assert.equal(calls.length, 9);
    // Each player's create -> reposition -> assign trio must complete, in order, before the next
    // player's create fires -- concurrent processing interleaves these across players instead.
    assert.deepEqual(calls.slice(3, 6).map((c) => c.method), ['POST', 'PATCH', 'PUT']);
    assert.equal(calls[5].url, 'https://discord.com/api/v10/guilds/test-guild-id/members/user-1/roles/role-1');
    assert.deepEqual(calls.slice(6, 9).map((c) => c.method), ['POST', 'PATCH', 'PUT']);
    assert.equal(calls[8].url, 'https://discord.com/api/v10/guilds/test-guild-id/members/user-2/roles/role-2');
  });

  clearEnv();
  report();
}

await main();
