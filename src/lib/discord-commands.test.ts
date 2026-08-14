/**
 * Unit tests for discord-commands.ts's slash command handlers (#396).
 *
 * Run:  npx vitest run src/lib/discord-commands.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { handleLeaderboardCommand, handleScheduledCommand, handlePlayerCommand } from './discord-commands';
import type { DiscordInteraction } from './discordInteractions';
import { test, report } from './test-support/miniTest';

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

  report();
}

await main();
