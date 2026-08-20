/**
 * Unit tests for discord-threads.ts: `publishWeekThreads()`'s admin-triggered weekly match-thread
 * publish (#398) — forum-channel resolution, per-match idempotency checked against Discord itself
 * (not `match_discord_state`, so a hand-created thread is discovered and adopted rather than
 * duplicated), and the ops_errors observability trail alongside the per-match results returned to the
 * caller — plus `closeMatchThread()`'s best-effort single-match close, the score route's hook on the
 * transition into "played".
 *
 * Run:  npx vitest run src/lib/discord-threads.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient, type Row } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';

const fakeDb = buildFakeDb();
// Alice (1) and Bob (2) linked their Discord accounts — used to assert the opening post mentions
// linked players and falls back to a plain name for unlinked ones (Carol, 3; Dave, 4). A fresh array
// so this doesn't mutate the shared PLAYERS fixture other test files also read.
fakeDb.players = fakeDb.players.map((p) =>
  p.id === 1 ? { ...p, discord_id: 'discord-alice' } : p.id === 2 ? { ...p, discord_id: 'discord-bob' } : p,
);
const adminClient = createFakeSupabaseClient(fakeDb);
__setTestClient(adminClient);

import { publishWeekThreads, closeMatchThread } from './discord-threads';
import { test, report } from './test-support/miniTest';

const GUILD_CHANNELS = [
  { id: 'channel-season-5', name: 'season-5', type: 15 },
  { id: 'channel-season-6', name: 'season-6', type: 15 },
];

interface FetchCall {
  url: string;
  init?: RequestInit;
}

interface StubThread {
  id: string;
  name: string;
  parent_id?: string;
}

/**
 * Stubs the guild-channels lookup, `listChannelThreads()`'s active/archived listing, and thread
 * creation. `opts.existingThreads` seeds threads Discord already "has" before any create call —
 * simulating one an admin made by hand — and every thread this stub's own create endpoint accepts
 * gets appended to that same live list, so a second `publishWeekThreads()` call against the *same*
 * stub instance (not a fresh `stubDiscord()`) sees its own prior output, the same way real Discord
 * would. That's what makes the re-publish idempotency tests below meaningful: idempotency is checked
 * against this simulated Discord state, never against `match_discord_state`.
 */
function stubDiscord(
  opts: { threadStatus?: number; threadBody?: unknown; existingThreads?: StubThread[] } = {},
): { calls: FetchCall[]; threads: StubThread[] } {
  const calls: FetchCall[] = [];
  const threads: StubThread[] = [...(opts.existingThreads ?? [])];
  let threadCounter = 0;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/channels')) {
      return { ok: true, status: 200, json: async () => GUILD_CHANNELS } as unknown as Response;
    }
    if (url.endsWith('/threads/active')) {
      return { ok: true, status: 200, json: async () => ({ threads }) } as unknown as Response;
    }
    if (url.includes('/threads/archived/public')) {
      return { ok: true, status: 200, json: async () => ({ threads: [] }) } as unknown as Response;
    }
    if (url.endsWith('/threads')) {
      const status = opts.threadStatus ?? 200;
      const ok = status >= 200 && status < 300;
      if (!ok) {
        return { ok, status, json: async () => opts.threadBody ?? { message: 'Missing Access' } } as unknown as Response;
      }
      const parentId = url.match(/\/channels\/([^/]+)\/threads$/)?.[1];
      const name = (JSON.parse(init?.body as string) as { name: string }).name;
      const id = `thread-${++threadCounter}`;
      threads.push({ id, name, parent_id: parentId });
      return { ok, status, json: async () => opts.threadBody ?? { id } } as unknown as Response;
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;
  return { calls, threads };
}

function stubDiscordClose(status = 200, body?: unknown): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const ok = status >= 200 && status < 300;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { ok, status, json: async () => body ?? (ok ? {} : { message: 'Missing Permissions' }) } as unknown as Response;
  }) as typeof fetch;
  return { calls };
}

function liveOpsErrors(entityType: string, entityId: number, operation: string): Row[] {
  return fakeDb.ops_errors.filter(
    (r) => r.entity_type === entityType && r.entity_id === entityId && r.operation === operation && r.dismissed_at === null,
  );
}

async function main() {
  await test('publishWeekThreads: errors without Discord config', async () => {
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_GUILD_ID;
    const result = await publishWeekThreads(adminClient, 1, 1);
    assert.ok('error' in result);
    assert.match((result as { error: string }).error, /not configured/);
  });

  await test('publishWeekThreads: refuses a gauntlet season', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    // Season 2 ("Season 5 Gauntlet") is_gauntlet=true.
    const result = await publishWeekThreads(adminClient, 2, 1);
    assert.ok('error' in result);
    assert.match((result as { error: string }).error, /Gauntlet/);
  });

  await test('publishWeekThreads: errors for a nonexistent season', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const result = await publishWeekThreads(adminClient, 9999, 1);
    assert.deepEqual(result, { error: 'Season not found' });
  });

  await test('publishWeekThreads: errors for a week that does not exist', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const result = await publishWeekThreads(adminClient, 1, 99);
    assert.deepEqual(result, { error: 'Week 99 not found' });
  });

  await test('publishWeekThreads: creates a thread per match, mentioning linked players by id and unlinked players by name', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const { calls } = stubDiscord();
    // Season 1 ("Season 5"), week 1 (week_id 10) has matches 100 and 101.
    const result = await publishWeekThreads(adminClient, 1, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    assert.equal(ok.seasonName, 'Season 5');
    assert.equal(ok.weekNumber, 1);
    assert.equal(ok.matches.length, 2);
    assert.deepEqual(ok.matches.map((m) => m.status), ['created', 'created']);
    assert.deepEqual(ok.matches.map((m) => m.title), ['Week 1 Game 1', 'Week 1 Game 2']);

    const createCalls = calls.filter((c) => c.init?.method === 'POST');
    assert.equal(createCalls.length, 2);
    const firstBody = JSON.parse(createCalls[0].init?.body as string);
    assert.equal(firstBody.name, 'Week 1 Game 1');
    // Match 100: shirts Alice(1)+Bob(2, both linked), skins Carol(3)+Dave(4, unlinked).
    assert.equal(firstBody.message.content, '<@discord-alice> & <@discord-bob> vs Carol & Dave');

    const { data: state100 } = await adminClient.from('match_discord_state').select('thread_id').eq('match_id', 100).maybeSingle();
    assert.ok((state100 as { thread_id: string }).thread_id);
  });

  await test('publishWeekThreads: re-publishing the same week finds its own threads in Discord (not match_discord_state) and skips them', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    // One stub instance shared across both calls — its `threads` list is what Discord "actually has",
    // updated in place by the first call's creates, so the second call's idempotency check is really
    // reading that simulated Discord state, not any DB row.
    const { calls } = stubDiscord();
    const first = await publishWeekThreads(adminClient, 1, 1);
    assert.ok(!('error' in first));
    assert.deepEqual((first as Exclude<typeof first, { error: string }>).matches.map((m) => m.status), ['created', 'created']);

    const second = await publishWeekThreads(adminClient, 1, 1);
    assert.ok(!('error' in second));
    const ok = second as Exclude<typeof second, { error: string }>;
    assert.deepEqual(ok.matches.map((m) => m.status), ['skipped', 'skipped']);
    assert.equal(liveOpsErrors('match', 100, 'discord_thread_create').length, 1);
    assert.match(liveOpsErrors('match', 100, 'discord_thread_create')[0].message as string, /already exists in the channel/);

    // No new thread was created on the second call — only the first call's two POSTs ever happened.
    assert.equal(calls.filter((c) => c.init?.method === 'POST').length, 2);
  });

  await test('publishWeekThreads: finds a thread an admin created by hand and adopts it instead of duplicating or posting into it', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    // Week 2 (season 1, week_id 11) has one match, 102 — "Week 2 Game 1". Simulate an admin having
    // already created that exact thread by hand; match_discord_state has no record of it either way.
    const { calls } = stubDiscord({
      existingThreads: [{ id: 'admin-thread-1', name: 'Week 2 Game 1', parent_id: 'channel-season-5' }],
    });
    const result = await publishWeekThreads(adminClient, 1, 2);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    assert.equal(ok.matches.length, 1);
    assert.equal(ok.matches[0].status, 'skipped');
    assert.equal(ok.matches[0].detail, 'Already exists (thread admin-thread-1)');

    // Never touched — no thread-create POST was made at all.
    assert.equal(calls.filter((c) => c.init?.method === 'POST').length, 0);

    // Adopted into match_discord_state anyway, so closeMatchThread() can still find it once played.
    const { data } = await adminClient.from('match_discord_state').select('thread_id').eq('match_id', 102).maybeSingle();
    assert.equal((data as { thread_id: string }).thread_id, 'admin-thread-1');

    const rows = liveOpsErrors('match', 102, 'discord_thread_create');
    assert.equal(rows.length, 1);
    assert.match(rows[0].message as string, /already exists in the channel/);
  });

  await test('publishWeekThreads: "next" resolves to the first week with no played matches', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    stubDiscord();
    // Season 3 ("Season 6"), week 13 (week_number 1) is its only week, with match 400 unplayed
    // (final_score: null) — "next" must resolve to it regardless of the season's start_date.
    const result = await publishWeekThreads(adminClient, 3, 'next');
    assert.ok(!('error' in result));
    assert.equal((result as { weekNumber: number }).weekNumber, 1);
  });

  await test('publishWeekThreads: "next" skips a partially-played week for a fully-unplayed one', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    stubDiscord();
    // Season 1's week_number 1 already has match 100 played (out-of-order entry); week_number 2 has
    // only match 102, staged as "0-0" — unplayed. "next" must land on week_number 2, not 1, even
    // though week 1 isn't fully played either.
    const result = await publishWeekThreads(adminClient, 1, 'next');
    assert.ok(!('error' in result));
    assert.equal((result as { weekNumber: number }).weekNumber, 2);
  });

  await test('publishWeekThreads: a channel resolution failure is recorded to ops_errors (entity season) and returned directly', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string) => {
      if (url.endsWith('/channels')) return { ok: true, status: 200, json: async () => [] } as unknown as Response;
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;
    const result = await publishWeekThreads(adminClient, 1, 2);
    assert.ok('error' in result);
    assert.match((result as { error: string }).error, /No channel named "season-5"/);
    assert.equal(liveOpsErrors('season', 1, 'discord_thread_publish').length, 1);
  });

  await test('publishWeekThreads: a Discord API failure creating a thread is recorded per-match and reported as failed', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    stubDiscord({ threadStatus: 403, threadBody: { message: 'Missing Access' } });
    // Week 11 (season 1, week_number 2) has match 102, not yet threaded.
    const result = await publishWeekThreads(adminClient, 1, 2);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    assert.equal(ok.matches.length, 1);
    assert.equal(ok.matches[0].status, 'failed');
    assert.match(ok.matches[0].detail, /403/);
    assert.match(ok.matches[0].detail, /Missing Access/);
    const rows = liveOpsErrors('match', 102, 'discord_thread_create');
    assert.equal(rows.length, 1);
    assert.match(rows[0].message as string, /Missing Access/);
  });

  await test('closeMatchThread: no-ops without DISCORD_BOT_TOKEN', async () => {
    delete process.env.DISCORD_BOT_TOKEN;
    const { calls } = stubDiscordClose();
    await closeMatchThread(adminClient, 100);
    assert.equal(calls.length, 0);
  });

  await test('closeMatchThread: no-ops for a match with no recorded thread', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    // Match 200 (gauntlet) has never been threaded — no match_discord_state row at all.
    const { calls } = stubDiscordClose();
    await closeMatchThread(adminClient, 200);
    assert.equal(calls.length, 0);
  });

  await test('closeMatchThread: archives and locks the match\'s thread', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    // Give match 101 a thread first via a normal publish (season 1 week 1's second match).
    stubDiscord();
    await publishWeekThreads(adminClient, 1, 1);
    const { data } = await adminClient.from('match_discord_state').select('thread_id').eq('match_id', 101).maybeSingle();
    const threadId = (data as { thread_id: string }).thread_id;

    const { calls } = stubDiscordClose();
    await closeMatchThread(adminClient, 101);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://discord.com/api/v10/channels/${threadId}`);
    assert.equal(calls[0].init?.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), { archived: true, locked: true });
    assert.equal(liveOpsErrors('match', 101, 'discord_thread_close').length, 0);
  });

  await test('closeMatchThread: a Discord API failure is recorded to ops_errors', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    stubDiscordClose(403, { message: 'Missing Permissions' });
    await closeMatchThread(adminClient, 101);
    const rows = liveOpsErrors('match', 101, 'discord_thread_close');
    assert.equal(rows.length, 1);
    assert.match(rows[0].message as string, /403/);
    assert.match(rows[0].message as string, /Missing Permissions/);
  });

  await test('closeMatchThread: a later success clears the prior ops_errors row', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    assert.equal(liveOpsErrors('match', 101, 'discord_thread_close').length, 1, 'precondition: the previous test left a live error');
    stubDiscordClose(200);
    await closeMatchThread(adminClient, 101);
    assert.equal(liveOpsErrors('match', 101, 'discord_thread_close').length, 0);
  });

  await test('closeMatchThread: a thrown fetch error is recorded, not thrown', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    await assert.doesNotReject(() => closeMatchThread(adminClient, 101));
    const rows = liveOpsErrors('match', 101, 'discord_thread_close');
    assert.equal(rows.length, 1);
    assert.match(rows[0].message as string, /network down/);
  });

  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_GUILD_ID;
  report();
}

await main();
