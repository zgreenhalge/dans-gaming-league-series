/**
 * Unit tests for discord-event-sync.ts: `syncSeasonScheduledEvents()`'s correlation between a
 * season's unplayed matches and Discord scheduled events, via the earliest *live* event-share link
 * (`discord.com/events/{guild}/{event}`) found in each match's own thread (#398) — thread discovery
 * by title (independent of `match_discord_state`), the checkpointed scan (a full backward walk only
 * the first time a thread is seen, an `after=<checkpoint>` catch-up on every poll after that, and no
 * message fetch at all once an event is cached), writing a matched event's start time into
 * `matches.scheduled_at`, idempotency once already in sync, `no_thread`/`no_event` for a match nothing
 * has been threaded/shared for yet, a stale cached event resetting the checkpoint and being correctly
 * skipped by a live-aware rescan in favor of the true earliest still-valid share, and the ops_errors
 * trail for a real API failure.
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

interface StubEvent {
  id: string;
  scheduled_start_time: string;
  status: number;
}

function shareLink(eventId: string): string {
  return `https://discord.com/events/${GUILD_ID}/${eventId}`;
}

/** Stubs the guild-channels lookup, thread listing, scheduled-events listing, and per-thread message
 *  history — `messagesByThread` holds each thread's *entire* message set to date, oldest-first (as
 *  authored); the stub serves it back newest-first, filtered by whatever `before`/`after` cursor the
 *  code under test sends, exactly like real Discord. Passing the full growing history on each call
 *  (rather than just what's "new") lets a test simulate successive polls realistically: the code's own
 *  `after=<checkpoint>` should only ever see the messages actually posted since. Also records every
 *  fetched url so a test can assert whether a message fetch happened at all (a cache hit never should).
 *  `messagesError`, if set, fails every message-history fetch with the given status/body instead of
 *  serving `messagesByThread`. */
function stubDiscord(opts: {
  threads?: StubThread[];
  events?: StubEvent[];
  messagesByThread?: Record<string, StubMessage[]>;
  messagesError?: { status: number; body: unknown };
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
      return { ok: true, status: 200, json: async () => events } as unknown as Response;
    }
    const messagesMatch = url.match(/\/channels\/([^/]+)\/messages/);
    if (messagesMatch) {
      if (opts.messagesError) {
        return { ok: false, status: opts.messagesError.status, json: async () => opts.messagesError!.body } as unknown as Response;
      }
      const threadId = messagesMatch[1];
      const all = [...(messagesByThread[threadId] ?? [])].reverse(); // newest-first, like real Discord
      const params = new URL(url).searchParams;
      const beforeId = params.get('before');
      const afterId = params.get('after');
      let page = all;
      if (beforeId) {
        const idx = all.findIndex((m) => m.id === beforeId);
        page = all.slice(idx + 1);
      } else if (afterId) {
        const idx = all.findIndex((m) => m.id === afterId);
        page = idx === -1 ? [] : all.slice(0, idx); // everything newer than afterId, still newest-first
      }
      return { ok: true, status: 200, json: async () => page.slice(0, 100) } as unknown as Response;
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

async function discordState(matchId: number): Promise<Row | null> {
  const { data } = await adminClient
    .from('match_discord_state')
    .select('thread_id, event_id, message_checkpoint')
    .eq('match_id', matchId)
    .maybeSingle();
  return data as Row | null;
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
    const { calls } = stubDiscord({ events: [] });
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    assert.equal(ok.matches.length, 2);
    assert.ok(ok.matches.every((m) => m.status === 'no_thread'));
    assert.ok(!calls.some((c) => c.includes('/messages')));
  });

  // ─── Match 101: a first-time scan that finds its event immediately ─────────────────────────────

  await test('syncSeasonScheduledEvents: first-time scan takes the earliest shared event across paginated history, and caches it', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    // A first page's worth of unrelated chatter, an early (correct) share, then more chatter and a
    // later re-share — the earliest one must win even though it's on the older (further-back) page.
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

    const state = await discordState(101);
    assert.equal(state?.event_id, '2222222222222222222');
    assert.equal(state?.message_checkpoint, 'm-last'); // the thread's current newest message
  });

  await test('syncSeasonScheduledEvents: a cached event id skips scanning messages entirely', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    const { calls } = stubDiscord({
      threads: [{ id: 'thread-101', name: 'Week 1 Game 2', parent_id: 'channel-season-5' }],
      events: [{ id: '2222222222222222222', scheduled_start_time: '2026-01-18T18:00:00.000Z', status: 1 }],
      // No messagesByThread entry — if the code tried to fetch messages for thread-101, the stub
      // would throw on `unexpected fetch`.
    });
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    const m101 = ok.matches.find((m) => m.matchId === 101)!;
    assert.equal(m101.status, 'unchanged');
    assert.ok(!calls.some((c) => c.includes('/messages')));
  });

  await test('syncSeasonScheduledEvents: a canceled cached event is cleared, resetting the checkpoint too', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    // No messagesByThread needed — a cached event_id skips scanning, so clearing it shouldn't touch
    // messages this poll either.
    stubDiscord({
      threads: [{ id: 'thread-101', name: 'Week 1 Game 2', parent_id: 'channel-season-5' }],
      events: [{ id: '2222222222222222222', scheduled_start_time: '2026-01-18T18:00:00.000Z', status: 4 }], // CANCELED
    });
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    const m101 = ok.matches.find((m) => m.matchId === 101)!;
    assert.equal(m101.status, 'no_event');
    assert.match(m101.detail, /no longer scheduled/);

    const state = await discordState(101);
    assert.equal(state?.event_id, null);
    // Reset, not left at 'm-last' — a plain after=<checkpoint> resume would only ever look at messages
    // newer than m-last, but the real still-valid earliest share (see the next test) is older than that.
    assert.equal(state?.message_checkpoint, null);
  });

  await test('syncSeasonScheduledEvents: the forced rescan skips the now-invalid earliest mention and finds the true earliest still-live share', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    // Same thread-101 history as the very first scan: m0 mentions the now-canceled '2222...', m-last
    // mentions '3333...', which is still live. A scan blind to event validity would re-find '2222...'
    // as "earliest by text" and go nowhere; this asserts it's correctly skipped in favor of '3333...'.
    const filler = Array.from({ length: 99 }, (_, i) => ({ id: `f${i}`, content: 'gg' }));
    stubDiscord({
      threads: [{ id: 'thread-101', name: 'Week 1 Game 2', parent_id: 'channel-season-5' }],
      events: [
        { id: '2222222222222222222', scheduled_start_time: '2026-01-18T18:00:00.000Z', status: 4 }, // still CANCELED
        { id: '3333333333333333333', scheduled_start_time: '2026-01-22T18:00:00.000Z', status: 1 }, // still LIVE
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
    assert.match(m101.detail, /2026-01-22/); // '3333...''s time, not '2222...''s

    const state = await discordState(101);
    assert.equal(state?.event_id, '3333333333333333333');
  });

  // ─── Match 102: a first-time scan that finds nothing, then a later poll picks up a new share ────

  await test('syncSeasonScheduledEvents: first-time scan with nothing shared reports "no_event" and still checkpoints', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    stubDiscord({
      threads: [{ id: 'thread-102', name: 'Week 2 Game 1', parent_id: 'channel-season-5' }],
      events: [],
      messagesByThread: { 'thread-102': [{ id: 'm1', content: 'anyone free this weekend?' }] },
    });
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    const m102 = ok.matches.find((m) => m.matchId === 102)!;
    assert.equal(m102.status, 'no_event');

    const state = await discordState(102);
    assert.equal(state?.event_id, null);
    assert.equal(state?.message_checkpoint, 'm1');
  });

  await test('syncSeasonScheduledEvents: a later poll only fetches messages after the checkpoint, and picks up a newly shared event', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    // The thread's full history now includes m1 (already scanned) plus a new share posted since.
    const { calls } = stubDiscord({
      threads: [{ id: 'thread-102', name: 'Week 2 Game 1', parent_id: 'channel-season-5' }],
      events: [{ id: '5555555555555555555', scheduled_start_time: '2026-02-05T19:00:00.000Z', status: 1 }],
      messagesByThread: {
        'thread-102': [
          { id: 'm1', content: 'anyone free this weekend?' },
          { id: 'm2', content: `here's the event: ${shareLink('5555555555555555555')}` },
        ],
      },
    });
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    const m102 = ok.matches.find((m) => m.matchId === 102)!;
    assert.equal(m102.status, 'synced');

    const messageCall = calls.find((c) => c.includes('/messages'))!;
    assert.match(messageCall, /after=m1/);
    assert.ok(!messageCall.includes('before='));

    const state = await discordState(102);
    assert.equal(state?.event_id, '5555555555555555555');
    assert.equal(state?.message_checkpoint, 'm2');
  });

  await test('syncSeasonScheduledEvents: a Discord API failure scanning a thread is recorded per-match', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    // Clear match 102's cached event so this poll goes through the scan path again.
    await adminClient.from('match_discord_state').update({ event_id: null, message_checkpoint: null }).eq('match_id', 102);
    stubDiscord({
      threads: [{ id: 'thread-102', name: 'Week 2 Game 1', parent_id: 'channel-season-5' }],
      events: [],
      messagesError: { status: 403, body: { message: 'Missing Access' } },
    });
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    const m102 = ok.matches.find((m) => m.matchId === 102)!;
    assert.equal(m102.status, 'failed');
    assert.match(m102.detail, /403/);
    const rows = liveOpsErrors('match', 102, 'discord_event_sync');
    assert.equal(rows.length, 1);
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
