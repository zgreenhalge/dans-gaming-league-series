/**
 * Unit tests for discord-roles.ts's @Participants role sync (#397).
 *
 * Run:  npx vitest run src/lib/discord-roles.test.ts
 */

import assert from 'node:assert/strict';
import {
  grantParticipantRole,
  revokeParticipantRole,
  grantParticipantRoleToRoster,
  revokeParticipantRoleFromRoster,
} from './discord-roles';
import { test, report } from './test-support/miniTest';

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

async function main() {
  await test('grantParticipantRole: no-ops without discord_id', async () => {
    setEnv();
    const { calls } = stubFetch();
    await grantParticipantRole(null);
    assert.equal(calls.length, 0);
  });

  await test('grantParticipantRole: no-ops without full config', async () => {
    clearEnv();
    const { calls } = stubFetch();
    await grantParticipantRole('user-1');
    assert.equal(calls.length, 0);
  });

  await test('grantParticipantRole: PUTs the guild-member-role endpoint', async () => {
    setEnv();
    const { calls } = stubFetch();
    await grantParticipantRole('user-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[0].url, 'https://discord.com/api/v10/guilds/test-guild-id/members/user-1/roles/test-role-id');
  });

  await test('revokeParticipantRole: DELETEs the guild-member-role endpoint', async () => {
    setEnv();
    const { calls } = stubFetch();
    await revokeParticipantRole('user-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'DELETE');
  });

  await test('revokeParticipantRole: no-ops without discord_id', async () => {
    setEnv();
    const { calls } = stubFetch();
    await revokeParticipantRole(null);
    assert.equal(calls.length, 0);
  });

  await test('grantParticipantRole: swallows a 404 (not a guild member) silently', async () => {
    setEnv();
    stubFetch(404);
    await assert.doesNotReject(() => grantParticipantRole('user-1'));
  });

  await test('grantParticipantRole: swallows a network error rather than throwing', async () => {
    setEnv();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    await assert.doesNotReject(() => grantParticipantRole('user-1'));
  });

  await test('grantParticipantRoleToRoster: one call per linked player, skipping unlinked ones', async () => {
    setEnv();
    const { calls } = stubFetch();
    await grantParticipantRoleToRoster(['user-1', null, 'user-2', null]);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((c) => c.url).sort(), [
      'https://discord.com/api/v10/guilds/test-guild-id/members/user-1/roles/test-role-id',
      'https://discord.com/api/v10/guilds/test-guild-id/members/user-2/roles/test-role-id',
    ]);
  });

  await test('revokeParticipantRoleFromRoster: one call per linked player, skipping unlinked ones', async () => {
    setEnv();
    const { calls } = stubFetch();
    await revokeParticipantRoleFromRoster([null, 'user-3']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'DELETE');
  });

  clearEnv();
  report();
}

await main();
