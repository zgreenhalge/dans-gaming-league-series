/**
 * Unit tests for discord-notify.ts's best-effort #match-notifications webhook posts (#395),
 * including the ops_errors observability retrofit — a real webhook failure must be visible in the
 * admin console's Activity feed, not just a Vercel function log — and the single-message-per-match
 * behavior: `notifyMatchServerLive()` posts with `?wait=true` and remembers the message id in
 * `match_discord_state`, and `notifyMatchScoreReported()` edits that same message in place rather
 * than posting a second one, falling back to a new post only when there's nothing to edit.
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
  method: string;
  body: {
    embeds: [{
      title: string;
      description: string;
      color: number;
      url: string;
      author: { name: string };
      thumbnail?: { url: string };
      fields?: { name: string; value: string; inline?: boolean }[];
    }];
  };
}

/** Stubs `fetch` for one webhook call sequence. Every `ok` response carries a `.json()` resolving to
 * `{ id: "stub-msg-N" }` (a fresh id per call) so `postNewEmbed()`'s `res.json()` has something
 * realistic to parse, mirroring Discord's actual `?wait=true` response shape. */
function stubFetch(status = 200): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let counter = 0;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: JSON.parse(init?.body as string) });
    const ok = status >= 200 && status < 300;
    return { ok, status, json: async () => ({ id: `stub-msg-${++counter}` }) } as unknown as Response;
  }) as typeof fetch;
  return { calls };
}

function liveOpsErrors(matchId: number, operation: string): Row[] {
  return fakeDb.ops_errors.filter(
    (r) => r.entity_type === 'match' && r.entity_id === matchId && r.operation === operation && r.dismissed_at === null,
  );
}

function discordState(matchId: number): Row | undefined {
  return (fakeDb.match_discord_state ?? []).find((r) => r.match_id === matchId);
}

function resetDiscordState(matchId: number): void {
  fakeDb.match_discord_state = (fakeDb.match_discord_state ?? []).filter((r) => r.match_id !== matchId);
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

  await test('notifyMatchServerLive: posts a "Week N · Match M" title with the season as author, no box score', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    resetDiscordState(100);
    const { calls } = stubFetch();
    await notifyMatchServerLive(adminClient, 100);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    // ?wait=true is the only way a webhook POST returns the created message's id.
    assert.equal(calls[0].url, 'https://discord.example/webhook?wait=true');
    const embed = calls[0].body.embeds[0];
    assert.equal(embed.title, 'Week 1 · Match 1');
    assert.doesNotMatch(embed.title, /\n/, 'embed titles do not reliably support line breaks');
    assert.equal(embed.author.name, 'Season 5');
    assert.match(embed.description, /Server is live/);
    assert.match(embed.description, /Alice & Bob vs Carol & Dave on Foroglio/);
    assert.match(embed.description, /\/matches\/100$/);
    assert.equal(embed.url, embed.description.split('\n').pop());
    assert.match(embed.thumbnail?.url ?? '', /\/maps\/foroglio\.jpg$/);
    assert.equal(embed.fields, undefined, 'no stats exist yet when the server goes live');
    assert.equal(discordState(100)?.notification_message_id, 'stub-msg-1');
  });

  await test('notifyMatchScoreReported: posts a box score alongside the final result', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    resetDiscordState(100);
    const { calls } = stubFetch();
    await notifyMatchScoreReported(adminClient, 100);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, 'https://discord.example/webhook?wait=true');
    const embed = calls[0].body.embeds[0];
    assert.equal(embed.title, 'Week 1 · Match 1');
    assert.equal(embed.author.name, 'Season 5');
    assert.match(embed.description, /Match complete\*\*\n\*\*Final: 13-9/, '"Final: 13-9" is on its own line — descriptions support \\n, unlike titles');
    // Match 100's shirts_pick ('Foroglio') is the effective played map, not picked_map alone.
    assert.match(embed.description, /Alice & Bob vs Carol & Dave on Foroglio/);
    assert.match(embed.description, /\/matches\/100$/);

    assert.equal(embed.fields?.length, 2);
    const shirts = embed.fields?.find((f) => /Shirts/.test(f.name));
    const skins = embed.fields?.find((f) => /Skins/.test(f.name));
    assert.ok(shirts?.inline && skins?.inline, 'box score fields sit side by side');
    assert.match(shirts!.value, /Alice\s+20\/3\/15/);
    assert.match(shirts!.value, /Bob\s+18\/5\/16/);
    assert.match(skins!.value, /Carol\s+14\/4\/19/);
    assert.match(skins!.value, /Dave\s+12\/6\/20/);

    assert.equal(discordState(100)?.notification_message_id, 'stub-msg-1');
  });

  await test('notifyMatchScoreReported: edits the server-live message in place instead of posting a new one', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    resetDiscordState(100);
    stubFetch();
    await notifyMatchServerLive(adminClient, 100);
    const liveMessageId = discordState(100)?.notification_message_id;
    assert.ok(liveMessageId, 'precondition: server-live left a message id on record');

    const { calls } = stubFetch();
    await notifyMatchScoreReported(adminClient, 100);
    assert.equal(calls.length, 1, 'edits in place — no second message posted');
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(calls[0].url, `https://discord.example/webhook/messages/${liveMessageId}`);
    const embed = calls[0].body.embeds[0];
    assert.match(embed.description, /13-9/);
    assert.equal(embed.fields?.length, 2, 'the edit carries the box score the original live post never had');
    assert.equal(discordState(100)?.notification_message_id, liveMessageId, 'the source-of-truth message id is unchanged');
  });

  await test('notifyMatchScoreReported: falls back to posting new when editing the recorded message fails', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    resetDiscordState(100);
    fakeDb.match_discord_state.push({ match_id: 100, notification_message_id: 'stale-msg', thread_id: null, reminder_sent_at: null });

    const calls: FetchCall[] = [];
    let call = 0;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: JSON.parse(init?.body as string) });
      call++;
      // The edit (call 1) fails as if the stored message was deleted; the fallback post (call 2) succeeds.
      if (call === 1) return { ok: false, status: 404 } as Response;
      return { ok: true, status: 200, json: async () => ({ id: 'fresh-msg' }) } as unknown as Response;
    }) as typeof fetch;

    await notifyMatchScoreReported(adminClient, 100);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(calls[0].url, 'https://discord.example/webhook/messages/stale-msg');
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[1].url, 'https://discord.example/webhook?wait=true');
    assert.equal(discordState(100)?.notification_message_id, 'fresh-msg', 'the fallback post\'s id becomes the new source of truth');
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
