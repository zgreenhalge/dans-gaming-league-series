/**
 * Unit tests for discord-commands.ts's slash command handlers (#396).
 *
 * Run:  npx vitest run src/lib/discord-commands.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';

const db = buildFakeDb();
__setTestClient(createFakeSupabaseClient(db));

import { handleLeaderboardCommand, handleScheduledCommand, handlePlayerCommand, handleNameColorCommand } from './discord-commands';
import type { DiscordInteraction } from './discordInteractions';
import { test, report } from './test-support/miniTest';

const NAME_COLOR_ENV_KEYS = ['DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID'] as const;

function setNameColorEnv() {
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  process.env.DISCORD_GUILD_ID = 'test-guild-id';
}

function clearNameColorEnv() {
  for (const key of NAME_COLOR_ENV_KEYS) delete process.env[key];
}

function stubFetch(status: number) {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () =>
    ({ ok: status >= 200 && status < 300, status }) as Response) as typeof fetch;
}

function interaction(options?: { name: string; value: string | number }[], callerId?: string): DiscordInteraction {
  return {
    type: 2,
    data: { name: 'test', options },
    ...(callerId ? { user: { id: callerId } } : {}),
  };
}

async function main() {
  await test('handleLeaderboardCommand: no season option defaults to the active season', async () => {
    const res = await handleLeaderboardCommand(interaction());
    assert.equal(res.type, 4);
    // Fixture's one ACTIVE non-gauntlet season is "Season 6" (id 3).
    assert.match(res.data.content, /Season 6/);
  });

  await test('handleLeaderboardCommand: an explicit season number resolves that season', async () => {
    const res = await handleLeaderboardCommand(interaction([{ name: 'season', value: 5 }]));
    assert.match(res.data.content, /Season 5/);
  });

  await test('handleLeaderboardCommand: a nonexistent season number reports not found', async () => {
    const res = await handleLeaderboardCommand(interaction([{ name: 'season', value: 999 }]));
    assert.match(res.data.content, /No regular season 999 found/);
  });

  await test('handleScheduledCommand: returns a well-formed response without throwing', async () => {
    const res = await handleScheduledCommand();
    assert.equal(res.type, 4);
    assert.equal(typeof res.data.content, 'string');
    assert.ok(res.data.content.length > 0);
  });

  await test('handlePlayerCommand: resolves a played player by name, with career stats', async () => {
    const res = await handlePlayerCommand(interaction([{ name: 'name', value: 'Alice' }]));
    assert.match(res.data.content, /Alice/);
    assert.match(res.data.content, /Career:/);
  });

  await test('handlePlayerCommand: a player with no played matches reports so', async () => {
    const res = await handlePlayerCommand(interaction([{ name: 'name', value: 'Erin' }]));
    assert.match(res.data.content, /hasn't played a match yet/);
  });

  await test('handlePlayerCommand: an unknown name reports not found', async () => {
    const res = await handlePlayerCommand(interaction([{ name: 'name', value: 'Nobody' }]));
    assert.match(res.data.content, /No player named "Nobody" found/);
  });

  await test('handlePlayerCommand: no name and no linked Discord account prompts to link', async () => {
    const res = await handlePlayerCommand(interaction(undefined, 'unlinked-discord-id'));
    assert.match(res.data.content, /not linked to a DGLS player/);
  });

  await test('handlePlayerCommand: no name and no caller id at all prompts to link', async () => {
    const res = await handlePlayerCommand(interaction());
    assert.match(res.data.content, /not linked to a DGLS player/);
  });

  await test('handleNameColorCommand: rejects an invalid hex color', async () => {
    const res = await handleNameColorCommand(interaction([{ name: 'hex', value: 'not-a-color' }], 'user-1'));
    assert.match(res.data.content, /doesn't look like a hex color/);
  });

  await test('handleNameColorCommand: an unlinked caller is prompted to link', async () => {
    const res = await handleNameColorCommand(interaction([{ name: 'hex', value: 'ff5733' }], 'unlinked-discord-id'));
    assert.match(res.data.content, /not linked to a DGLS player/);
  });

  await test('handleNameColorCommand: a linked player with no name role is told how to get one', async () => {
    db.players.find((p) => p.id === 5)!.discord_id = 'user-no-role'; // Erin
    const res = await handleNameColorCommand(interaction([{ name: 'hex', value: 'ff5733' }], 'user-no-role'));
    assert.match(res.data.content, /don't have a name role/);
  });

  await test('handleNameColorCommand: sets the role color and confirms', async () => {
    const frank = db.players.find((p) => p.id === 6)!;
    frank.discord_id = 'user-with-role';
    frank.discord_name_role_id = 'role-abc';
    setNameColorEnv();
    stubFetch(200);
    const res = await handleNameColorCommand(interaction([{ name: 'hex', value: '#ff5733' }], 'user-with-role'));
    clearNameColorEnv();
    assert.match(res.data.content, /Updated your name color to #ff5733/);
  });

  await test('handleNameColorCommand: reports a Discord API failure', async () => {
    const grace = db.players.find((p) => p.id === 7)!;
    grace.discord_id = 'user-fail';
    grace.discord_name_role_id = 'role-def';
    setNameColorEnv();
    stubFetch(403);
    const res = await handleNameColorCommand(interaction([{ name: 'hex', value: 'ff5733' }], 'user-fail'));
    clearNameColorEnv();
    assert.match(res.data.content, /Couldn't set your role color/);
  });

  report();
}

await main();
