/**
 * Unit tests for discord-notify.ts's best-effort #match-notifications webhook posts (#395),
 * including the ops_errors observability retrofit — a real webhook failure must be visible in the
 * admin console's Activity feed, not just a Vercel function log.
 *
 * Run:  npx vitest run src/lib/discord-notify.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient, type Row } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';

const fakeDb = buildFakeDb();
const adminClient = createFakeSupabaseClient(fakeDb);
__setTestClient(adminClient);

import { notifyMatchServerLive, notifyMatchScoreReported } from './discord-notify';
import { test, report } from './test-support/miniTest';

interface FetchCall {
  url: string;
  body: { embeds: [{ title: string; description?: string; color: number }] };
}

function stubFetch(status = 200): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(init?.body as string) });
    return { ok: status >= 200 && status < 300, status } as Response;
  }) as typeof fetch;
  return { calls };
}

function liveOpsErrors(matchId: number, operation: string): Row[] {
  return fakeDb.ops_errors.filter(
    (r) => r.entity_type === 'match' && r.entity_id === matchId && r.operation === operation && r.dismissed_at === null,
  );
}

async function main() {
  await test('notifyMatchServerLive: no-ops without DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL', async () => {
    delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
    const { calls } = stubFetch();
    await notifyMatchServerLive(adminClient, 100);
    assert.equal(calls.length, 0);
  });

  await test('notifyMatchScoreReported: no-ops without DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL', async () => {
    delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
    const { calls } = stubFetch();
    await notifyMatchScoreReported(adminClient, 100);
    assert.equal(calls.length, 0);
  });

  await test('notifyMatchServerLive: posts an embed naming both rosters', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    const { calls } = stubFetch();
    await notifyMatchServerLive(adminClient, 100);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://discord.example/webhook');
    const embed = calls[0].body.embeds[0];
    assert.match(embed.title, /Server is live/);
    assert.equal(embed.description, 'Alice & Bob vs Carol & Dave');
  });

  await test('notifyMatchScoreReported: posts the final score and effective map', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    const { calls } = stubFetch();
    await notifyMatchScoreReported(adminClient, 100);
    assert.equal(calls.length, 1);
    const embed = calls[0].body.embeds[0];
    assert.match(embed.title, /13-9/);
    // Match 100's shirts_pick ('Foroglio') is the effective played map, not picked_map alone.
    assert.equal(embed.description, 'Alice & Bob vs Carol & Dave on Foroglio');
  });

  await test('notifyMatchScoreReported: no-ops for an unplayed match (final_score null)', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    const { calls } = stubFetch();
    await notifyMatchScoreReported(adminClient, 101);
    assert.equal(calls.length, 0);
  });

  await test('notifyMatchServerLive: no-ops for a nonexistent match', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    const { calls } = stubFetch();
    await notifyMatchServerLive(adminClient, 9999);
    assert.equal(calls.length, 0);
  });

  await test('notifyMatchServerLive: swallows a webhook failure rather than throwing', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    await assert.doesNotReject(() => notifyMatchServerLive(adminClient, 100));
  });

  await test('notifyMatchServerLive: a thrown fetch error is recorded to ops_errors', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    await notifyMatchServerLive(adminClient, 100);
    const rows = liveOpsErrors(100, 'discord_notify_server_live');
    assert.equal(rows.length, 1);
    assert.match(rows[0].message as string, /network down/);
  });

  await test('notifyMatchServerLive: a non-ok response is recorded to ops_errors', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    stubFetch(500);
    await notifyMatchServerLive(adminClient, 100);
    const rows = liveOpsErrors(100, 'discord_notify_server_live');
    assert.equal(rows.length, 1);
    assert.match(rows[0].message as string, /500/);
  });

  await test('notifyMatchServerLive: a later success clears the prior ops_errors row', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    assert.equal(liveOpsErrors(100, 'discord_notify_server_live').length, 1, 'precondition: the previous test left a live error');
    stubFetch(200);
    await notifyMatchServerLive(adminClient, 100);
    assert.equal(liveOpsErrors(100, 'discord_notify_server_live').length, 0);
  });

  await test("a server-live failure and a score-reported success for the same match don't clear each other's ops_errors row", async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    stubFetch(500);
    await notifyMatchServerLive(adminClient, 100);
    assert.equal(liveOpsErrors(100, 'discord_notify_server_live').length, 1, 'precondition: server-live failed');

    stubFetch(200);
    await notifyMatchScoreReported(adminClient, 100);
    assert.equal(liveOpsErrors(100, 'discord_notify_score').length, 0, 'score-reported succeeded');
    assert.equal(liveOpsErrors(100, 'discord_notify_server_live').length, 1, 'the unrelated server-live failure is still live');
  });

  delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  report();
}

await main();
