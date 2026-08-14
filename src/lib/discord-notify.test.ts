/**
 * Unit tests for discord-notify.ts's best-effort #match-notifications webhook posts (#395).
 *
 * Run:  npx vitest run src/lib/discord-notify.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { notifyMatchServerLive, notifyMatchScoreReported } from './discord-notify';
import { test, report } from './test-support/miniTest';

interface FetchCall {
  url: string;
  body: { embeds: [{ title: string; description?: string; color: number }] };
}

function stubFetch(): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(init?.body as string) });
    return { ok: true, status: 200 } as Response;
  }) as typeof fetch;
  return { calls };
}

async function main() {
  await test('notifyMatchServerLive: no-ops without DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL', async () => {
    delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
    const { calls } = stubFetch();
    await notifyMatchServerLive(100);
    assert.equal(calls.length, 0);
  });

  await test('notifyMatchScoreReported: no-ops without DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL', async () => {
    delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
    const { calls } = stubFetch();
    await notifyMatchScoreReported(100);
    assert.equal(calls.length, 0);
  });

  await test('notifyMatchServerLive: posts an embed naming both rosters', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    const { calls } = stubFetch();
    await notifyMatchServerLive(100);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://discord.example/webhook');
    const embed = calls[0].body.embeds[0];
    assert.match(embed.title, /Server is live/);
    assert.equal(embed.description, 'Alice & Bob vs Carol & Dave');
  });

  await test('notifyMatchScoreReported: posts the final score and effective map', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    const { calls } = stubFetch();
    await notifyMatchScoreReported(100);
    assert.equal(calls.length, 1);
    const embed = calls[0].body.embeds[0];
    assert.match(embed.title, /13-9/);
    // Match 100's shirts_pick ('Foroglio') is the effective played map, not picked_map alone.
    assert.equal(embed.description, 'Alice & Bob vs Carol & Dave on Foroglio');
  });

  await test('notifyMatchScoreReported: no-ops for an unplayed match (final_score null)', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    const { calls } = stubFetch();
    await notifyMatchScoreReported(101);
    assert.equal(calls.length, 0);
  });

  await test('notifyMatchServerLive: no-ops for a nonexistent match', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    const { calls } = stubFetch();
    await notifyMatchServerLive(9999);
    assert.equal(calls.length, 0);
  });

  await test('notifyMatchServerLive: swallows a webhook failure rather than throwing', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    await assert.doesNotReject(() => notifyMatchServerLive(100));
  });

  delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  report();
}

await main();
