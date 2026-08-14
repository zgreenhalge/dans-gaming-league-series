/**
 * Unit tests for discord-command-registration.ts's registerDiscordCommands() (#396) — the shared
 * PUT-to-Discord call behind both scripts/register-discord-commands.ts and
 * POST /api/admin/discord/register-commands.
 *
 * Run:  npx vitest run src/lib/discord-command-registration.test.ts
 */

import assert from 'node:assert/strict';
import { registerDiscordCommands, DISCORD_COMMANDS } from './discord-command-registration';
import { test, report } from './test-support/miniTest';

const ENV_KEYS = ['DISCORD_APPLICATION_ID', 'DISCORD_BOT_TOKEN'] as const;

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function setEnv() {
  process.env.DISCORD_APPLICATION_ID = 'test-app-id';
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
}

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stubFetch(status: number, json: unknown): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => JSON.stringify(json) } as Response;
  }) as typeof fetch;
  return { calls };
}

async function main() {
  await test('fails fast without DISCORD_APPLICATION_ID/DISCORD_BOT_TOKEN', async () => {
    clearEnv();
    const { calls } = stubFetch(200, []);
    const result = await registerDiscordCommands();
    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
  });

  await test('PUTs the full command set to the application command endpoint', async () => {
    setEnv();
    const registered = DISCORD_COMMANDS.map((c) => ({ name: c.name }));
    const { calls } = stubFetch(200, registered);
    const result = await registerDiscordCommands();
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.names, ['leaderboard', 'scheduled', 'player']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[0].url, 'https://discord.com/api/v10/applications/test-app-id/commands');
    assert.equal(calls[0].headers.Authorization, 'Bot test-bot-token');
    assert.deepEqual(calls[0].body, DISCORD_COMMANDS);
  });

  await test('surfaces a non-ok Discord response as an error result', async () => {
    setEnv();
    stubFetch(401, { message: 'Unauthorized' });
    const result = await registerDiscordCommands();
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : '', /401/);
  });

  clearEnv();
  report();
}

await main();
