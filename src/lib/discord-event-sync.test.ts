/**
 * Unit tests for discord-event-sync.ts: `syncSeasonScheduledEvents()`'s correlation between a
 * season's unplayed matches and Discord scheduled events, via the earliest event-share link
 * (`discord.com/events/{guild}/{event}`) found in each match's own thread (#398) — thread discovery
 * by title (independent of `match_discord_state`), writing a matched event's start time into
 * `matches.scheduled_at`, idempotency once already in sync, `no_thread`/`no_event` for a match
 * nothing has been threaded/shared for yet, and the ops_errors trail for a real API failure.
 *
 * Run:  npx vitest run src/lib/discord-event-sync.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient, type Row } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';

const fakeDb = buildFakeDb();
const adminClient = createFakeSupabaseClient(fakeDb);
__setTestClient(adminClient);

import { syncSeasonScheduledEvents } from './discord-event-sync';
import { test, report } from './test-support/miniTest';

const GUILD_ID = 'guild-1';
const GUILD_CHANNELS = [
  { id: 'channel-season-5', name: 'season-5', type: 15 },
  { id: 'channel-season-6', name: 'season-6', type: 15 },
];

interface StubThread {
  id: string;
  name: string;
  parent_id?: string;
}

interface StubMessage {
  id: string;
  content: string;
}

function shareLink(eventId: string): string {
  return `https://discord.com/events/${GUILD_ID}/${eventId}`;
}

/** Stubs the guild-channels lookup, thread listing, scheduled-events listing, and per-thread message
 *  history — `messagesByThread` holds each thread's messages oldest-first (as authored); the stub
 *  serves them back newest-first, one page at a time, matching Discord's real ordering and pagination
 *  (`before` cursor), so `findFirstSharedEventId()`'s backward walk is exercised for real. */
function stubDiscord(opts: {
  threads?: StubThread[];
  events?: { id: string; scheduled_start_time: string; status: number }[];
  messagesByThread?: Record<string, StubMessage[]>;
  eventsStatus?: number;
} = {}): { calls: string[] } {
  const calls: string[] = [];
  const threads = opts.threads ?? [];
  const events = opts.events ?? [];
  const messagesByThread = opts.messagesByThread ?? {};

  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string) => {
    calls.push(url);
    if (url.endsWith('/channels')) {
      return { ok: true, status: 200, json: async () => GUILD_CHANNELS } as unknown as Response;
    }
    if (url.endsWith('/threads/active')) {
      return { ok: true, status: 200, json: async () => ({ threads }) } as unknown as Response;
    }
    if (url.includes('/threads/archived/public')) {
      return { ok: true, status: 200, json: async () => ({ threads: [] }) } as unknown as Response;
    }
    if (url.includes('/scheduled-events')) {
      const status = opts.eventsStatus ?? 200;
      const ok = status >= 200 && status < 300;
      if (!ok) return { ok, status, json: async () => ({ message: 'Missing Access' }) } as unknown as Response;
      return { ok, status, json: async () => events } as unknown as Response;
    }
    const messagesMatch = url.match(/\/channels\/([^/]+)\/messages/);
    if (messagesMatch) {
      const threadId = messagesMatch[1];
      const all = [...(messagesByThread[threadId] ?? [])].reverse(); // newest-first, like real Discord
      const beforeId = new URL(url).searchParams.get('before');
      const startIndex = beforeId ? all.findIndex((m) => m.id === beforeId) + 1 : 0;
      const page = all.slice(startIndex, startIndex + 100);
      return { ok: true, status: 200, json: async () => page } as unknown as Response;
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;
  return { calls };
}

function liveOpsErrors(entityType: string, entityId: number, operation: string): Row[] {
  return fakeDb.ops_errors.filter(
    (r) => r.entity_type === entityType && r.entity_id === entityId && r.operation === operation && r.dismissed_at === null,
  );
}

async function main() {
  await test('syncSeasonScheduledEvents: errors without Discord config', async () => {
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_GUILD_ID;
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok('error' in result);
    assert.match((result as { error: string }).error, /not configured/);
  });

  await test('syncSeasonScheduledEvents: refuses a gauntlet season', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    const result = await syncSeasonScheduledEvents(adminClient, 2);
    assert.ok('error' in result);
    assert.match((result as { error: string }).error, /Gauntlet/);
  });

  await test('syncSeasonScheduledEvents: errors for a nonexistent season', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    const result = await syncSeasonScheduledEvents(adminClient, 9999);
    assert.deepEqual(result, { error: 'Season not found' });
  });

  await test('syncSeasonScheduledEvents: no thread yet reports "no_thread" without touching messages', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    // Season 1 ("Season 5"): match 101 (week 1, unplayed) and 102 (week 2, unplayed "0-0") — neither
    // has a Discord thread in this scenario.
    stubDiscord({ events: [] });
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    assert.equal(ok.matches.length, 2);
    assert.ok(ok.matches.every((m) => m.status === 'no_thread'));
  });

  await test('syncSeasonScheduledEvents: a threaded match with nothing shared yet reports "no_event"', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    stubDiscord({
      threads: [{ id: 'thread-101', name: 'Week 1 Game 2', parent_id: 'channel-season-5' }],
      events: [],
      messagesByThread: { 'thread-101': [{ id: 'm1', content: 'anyone free this weekend?' }] },
    });
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    const m101 = ok.matches.find((m) => m.matchId === 101)!;
    assert.equal(m101.status, 'no_event');
  });

  await test('syncSeasonScheduledEvents: finds a shared event link and syncs scheduled_at', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    stubDiscord({
      threads: [{ id: 'thread-101', name: 'Week 1 Game 2', parent_id: 'channel-season-5' }],
      events: [{ id: '1111111111111111111', scheduled_start_time: '2026-01-20T20:00:00.000Z', status: 1 }],
      messagesByThread: {
        'thread-101': [
          { id: 'm1', content: 'setting this up' },
          { id: 'm2', content: `here's the event: ${shareLink('1111111111111111111')}` },
        ],
      },
    });
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    const m101 = ok.matches.find((m) => m.matchId === 101)!;
    assert.equal(m101.status, 'synced');

    const { data } = await adminClient.from('matches').select('scheduled_at').eq('id', 101).maybeSingle();
    assert.equal((data as { scheduled_at: string }).scheduled_at, '2026-01-20T20:00:00.000Z');
  });

  await test('syncSeasonScheduledEvents: a re-sync against the same shared event reports "unchanged" and writes nothing', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    // Match 101's scheduled_at is now '2026-01-20T20:00:00.000Z' from the previous test.
    stubDiscord({
      threads: [{ id: 'thread-101', name: 'Week 1 Game 2', parent_id: 'channel-season-5' }],
      events: [{ id: '1111111111111111111', scheduled_start_time: '2026-01-20T20:00:00.000Z', status: 1 }],
      messagesByThread: {
        'thread-101': [{ id: 'm2', content: `here's the event: ${shareLink('1111111111111111111')}` }],
      },
    });
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    const m101 = ok.matches.find((m) => m.matchId === 101)!;
    assert.equal(m101.status, 'unchanged');
  });

  await test('syncSeasonScheduledEvents: takes the earliest shared event, not a later re-share, across paginated history', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    // A first page's worth of unrelated chatter, an early (correct) share, then more chatter and a
    // second share later — the earliest one must win even though it's on the older page.
    const filler = Array.from({ length: 99 }, (_, i) => ({ id: `f${i}`, content: 'gg' }));
    stubDiscord({
      threads: [{ id: 'thread-101', name: 'Week 1 Game 2', parent_id: 'channel-season-5' }],
      events: [
        { id: '2222222222222222222', scheduled_start_time: '2026-01-18T18:00:00.000Z', status: 1 },
        { id: '3333333333333333333', scheduled_start_time: '2026-01-22T18:00:00.000Z', status: 1 },
      ],
      messagesByThread: {
        'thread-101': [
          { id: 'm0', content: `first pass: ${shareLink('2222222222222222222')}` },
          ...filler,
          { id: 'm-last', content: `oops wrong one, use this: ${shareLink('3333333333333333333')}` },
        ],
      },
    });
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    const m101 = ok.matches.find((m) => m.matchId === 101)!;
    assert.equal(m101.status, 'synced');
    assert.match(m101.detail, /2026-01-18/);
  });

  await test('syncSeasonScheduledEvents: ignores a CANCELED event with a shared link', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    stubDiscord({
      threads: [{ id: 'thread-102', name: 'Week 2 Game 1', parent_id: 'channel-season-5' }],
      events: [{ id: '4444444444444444444', scheduled_start_time: '2026-02-01T18:00:00.000Z', status: 4 }],
      messagesByThread: { 'thread-102': [{ id: 'm1', content: shareLink('4444444444444444444') }] },
    });
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    const m102 = ok.matches.find((m) => m.matchId === 102)!;
    assert.equal(m102.status, 'no_event');
  });

  await test('syncSeasonScheduledEvents: a season with no unplayed matches returns an empty result without calling Discord', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    const { calls } = stubDiscord();
    // Season 3 ("Season 6"): mark its one match (400) played for this test only, restored after.
    const match400 = fakeDb.matches.find((m) => m.id === 400)!;
    const original = match400.final_score;
    match400.final_score = '13-4';
    try {
      const result = await syncSeasonScheduledEvents(adminClient, 3);
      assert.ok(!('error' in result));
      assert.deepEqual((result as { matches: unknown[] }).matches, []);
      assert.equal(calls.length, 0);
    } finally {
      match400.final_score = original;
    }
  });

  await test('syncSeasonScheduledEvents: a Discord API failure resolving the channel is recorded to ops_errors (entity season) and returned directly', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string) => {
      if (url.endsWith('/channels')) return { ok: true, status: 200, json: async () => [] } as unknown as Response;
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok('error' in result);
    assert.match((result as { error: string }).error, /No channel named "season-5"/);
    assert.equal(liveOpsErrors('season', 1, 'discord_event_sync').length, 1);
  });

  await test('syncSeasonScheduledEvents: a later success clears the prior ops_errors row', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    assert.equal(liveOpsErrors('season', 1, 'discord_event_sync').length, 1, 'precondition: the previous test left a live error');
    stubDiscord({ events: [] });
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    assert.equal(liveOpsErrors('season', 1, 'discord_event_sync').length, 0);
  });

  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_GUILD_ID;
  report();
}

await main();
