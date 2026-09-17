/**
 * Unit tests for discord-threads.ts: `publishWeekThreads()`'s admin-triggered weekly match-thread
 * publish (#398) — forum-channel resolution, per-match idempotency that prefers a previously-recorded
 * `match_discord_state.thread_id` (once confirmed still live) and falls back to an exact title match
 * against Discord itself otherwise, so a hand-created thread is discovered and adopted rather than
 * duplicated, explicit thread-member addition for every linked, rostered participant on a newly
 * created thread (`addThreadMembers()` — a starter-message mention alone doesn't reliably add someone
 * as a member), and the ops_errors observability trail alongside the per-match results returned to the
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
// Alice (1) and Bob (2) linked their Discord accounts and have a name-color role — used to assert the
// opening post tags linked players by role and falls back to a plain name for unlinked ones (Carol,
// 3; Dave, 4). A fresh array so this doesn't mutate the shared PLAYERS fixture other test files also
// read.
fakeDb.players = fakeDb.players.map((p) =>
  p.id === 1 ? { ...p, discord_id: 'discord-alice', discord_name_role_id: 'role-alice' }
    : p.id === 2 ? { ...p, discord_id: 'discord-bob', discord_name_role_id: 'role-bob' } : p,
);
const adminClient = createFakeSupabaseClient(fakeDb);
__setTestClient(adminClient);

import { publishWeekThreads, publishPodThreads, closeMatchThread, closeGauntletPodThreadIfDone } from './discord-threads';
import { test, report } from './test-support/miniTest';

// Season 2 ("Season 5 Gauntlet")'s pod 1000 only carries match1_id (200) in the shared fixture — a
// transient state elsewhere in this test suite. The pod tests below need a real two-game pod, built
// on its own db/client instance (never mutating the shared fixture's row objects, only replacing
// them) so it doesn't leak into publishWeekThreads()'s own tests above, which read the same season 1
// data via the shared `adminClient`.
function podFakeDb() {
  const db = buildFakeDb();
  db.matches.push({ ...db.matches.find((m) => m.id === 200)!, id: 201, match_number: 2, final_score: null, scheduled_at: null });
  db.gauntlet_pods = db.gauntlet_pods.map((p) => (p.match1_id === 200 ? { ...p, match2_id: 201 } : p));
  db.player_match_stats = [
    ...db.player_match_stats,
    { id: 9001, match_id: 201, player_id: 1, faction: 'SHIRTS', kills: 0, assists: 0, deaths: 0, adr: 0, damage: 0, rounds_played: 0, rounds_won: 0, is_win: false },
    { id: 9002, match_id: 201, player_id: 5, faction: 'SHIRTS', kills: 0, assists: 0, deaths: 0, adr: 0, damage: 0, rounds_played: 0, rounds_won: 0, is_win: false },
    { id: 9003, match_id: 201, player_id: 2, faction: 'SKINS', kills: 0, assists: 0, deaths: 0, adr: 0, damage: 0, rounds_played: 0, rounds_won: 0, is_win: false },
    { id: 9004, match_id: 201, player_id: 6, faction: 'SKINS', kills: 0, assists: 0, deaths: 0, adr: 0, damage: 0, rounds_played: 0, rounds_won: 0, is_win: false },
  ];
  db.players = db.players.map((p) =>
    p.id === 1 ? { ...p, discord_id: 'discord-alice', discord_name_role_id: 'role-alice' }
      : p.id === 2 ? { ...p, discord_id: 'discord-bob', discord_name_role_id: 'role-bob' } : p,
  );
  return db;
}

// Round 2 of the same gauntlet, with two pods that finalize at different times — a bracket's
// parallel groups don't resolve in lockstep. Pod 0 (matches 210/211) is fully materialized, like
// round 1's pod; pod 1 has a shape (`gauntlet_pods` row) but no materialized games yet, modeling a
// group still waiting on an earlier round's winner. Built on `podFakeDb()`'s db so round 1's own pod
// stays in the mix for the cross-round sweep test below.
function splitRoundFakeDb() {
  const db = podFakeDb();
  db.weeks = [...db.weeks, { id: 15, season_id: 2, week_number: 2, bye_player_id: null }];
  db.matches = [
    ...db.matches,
    { ...db.matches.find((m) => m.id === 200)!, id: 210, week_id: 15, match_number: 1, final_score: null },
    { ...db.matches.find((m) => m.id === 201)!, id: 211, week_id: 15, match_number: 2, final_score: null },
  ];
  db.player_match_stats = [
    ...db.player_match_stats,
    { id: 9010, match_id: 210, player_id: 1, faction: 'SHIRTS', kills: 0, assists: 0, deaths: 0, adr: 0, damage: 0, rounds_played: 0, rounds_won: 0, is_win: false },
    { id: 9011, match_id: 210, player_id: 5, faction: 'SHIRTS', kills: 0, assists: 0, deaths: 0, adr: 0, damage: 0, rounds_played: 0, rounds_won: 0, is_win: false },
    { id: 9012, match_id: 210, player_id: 2, faction: 'SKINS', kills: 0, assists: 0, deaths: 0, adr: 0, damage: 0, rounds_played: 0, rounds_won: 0, is_win: false },
    { id: 9013, match_id: 210, player_id: 6, faction: 'SKINS', kills: 0, assists: 0, deaths: 0, adr: 0, damage: 0, rounds_played: 0, rounds_won: 0, is_win: false },
    { id: 9014, match_id: 211, player_id: 1, faction: 'SHIRTS', kills: 0, assists: 0, deaths: 0, adr: 0, damage: 0, rounds_played: 0, rounds_won: 0, is_win: false },
    { id: 9015, match_id: 211, player_id: 6, faction: 'SHIRTS', kills: 0, assists: 0, deaths: 0, adr: 0, damage: 0, rounds_played: 0, rounds_won: 0, is_win: false },
    { id: 9016, match_id: 211, player_id: 5, faction: 'SKINS', kills: 0, assists: 0, deaths: 0, adr: 0, damage: 0, rounds_played: 0, rounds_won: 0, is_win: false },
    { id: 9017, match_id: 211, player_id: 2, faction: 'SKINS', kills: 0, assists: 0, deaths: 0, adr: 0, damage: 0, rounds_played: 0, rounds_won: 0, is_win: false },
  ];
  db.gauntlet_pods = [
    ...db.gauntlet_pods,
    { id: 1002, season_id: 2, round_number: 2, pod_index: 0, advance_rule: 'single', is_final: false, week_id: 15, match1_id: 210, match2_id: 211 },
    { id: 1003, season_id: 2, round_number: 2, pod_index: 1, advance_rule: 'single', is_final: false, week_id: 15, match1_id: null, match2_id: null },
  ];
  return db;
}

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
  opts: { threadStatus?: number; threadBody?: unknown; existingThreads?: StubThread[]; memberAddStatus?: number; memberAddBody?: unknown } = {},
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
    if (url.includes('/thread-members/')) {
      const status = opts.memberAddStatus ?? 204;
      const ok = status >= 200 && status < 300;
      return { ok, status, json: async () => opts.memberAddBody ?? (ok ? {} : { message: 'Missing Permissions' }) } as unknown as Response;
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

/** Wraps a fake client so `.from(table).upsert(...)` resolves to `{ error }` instead of landing —
 * simulating a transient DB failure on `publishThread()`'s `match_discord_state` writes, which the
 * fake Supabase client itself has no way to produce (its `.upsert()` never fails). Every other table
 * still goes through the real fake client, since `publishThread()`'s Discord calls and
 * `recordOpsError()`/`clearOpsError()` still need `ops_errors`/season/schedule reads to work. */
function withFailingUpsert(client: ReturnType<typeof createFakeSupabaseClient>, table: string, message: string) {
  return {
    from(t: string) {
      if (t === table) return { upsert: () => Promise.resolve({ data: null, error: { code: 'TEST', message } }) };
      return client.from(t);
    },
    rpc: client.rpc.bind(client),
  } as unknown as typeof client;
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

  await test('publishWeekThreads: creates a thread per match, mentioning linked players by name-color role and unlinked players by name', async () => {
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
    // Match 100: shirts Alice(1)+Bob(2, both linked with a name-color role), skins Carol(3)+Dave(4, unlinked),
    // followed by a masked link to the match's own page — Discord auto-unfurls the (unwrapped) URL
    // underneath into its own rich preview card, so no manual embed is sent at all.
    assert.equal(
      firstBody.message.content,
      '<@&role-alice> & <@&role-bob> vs Carol & Dave — [Box Score](https://dans-gaming-league-series.vercel.app/matches/100)',
    );
    assert.equal(firstBody.message.embeds, undefined);

    const { data: state100 } = await adminClient.from('match_discord_state').select('thread_id').eq('match_id', 100).maybeSingle();
    assert.ok((state100 as { thread_id: string }).thread_id);

    // Pinging linked players in the opening post isn't enough to make them thread members (Discord
    // doesn't reliably add mentioned users from a thread's own starter message) — they're also
    // explicitly added via the thread-members endpoint. Only Alice/Bob are linked; Carol/Dave aren't.
    const threadId = (state100 as { thread_id: string }).thread_id;
    const memberAddCalls = calls.filter((c) => c.init?.method === 'PUT' && c.url.startsWith(`https://discord.com/api/v10/channels/${threadId}/thread-members/`));
    assert.deepEqual(
      memberAddCalls.map((c) => c.url).sort(),
      [
        `https://discord.com/api/v10/channels/${threadId}/thread-members/discord-alice`,
        `https://discord.com/api/v10/channels/${threadId}/thread-members/discord-bob`,
      ],
    );
  });

  await test('publishWeekThreads: a failure adding a thread member is recorded but does not fail the create', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    stubDiscord({ memberAddStatus: 403, memberAddBody: { message: 'Missing Permissions' } });
    const result = await publishWeekThreads(adminClient, 1, 2);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    // Match 102 (week 2) — the thread is still created even though adding its members failed.
    assert.equal(ok.matches[0].status, 'created');
    const rows = liveOpsErrors('match', 102, 'discord_thread_member_add');
    assert.equal(rows.length, 1);
    assert.match(rows[0].message as string, /403/);
    assert.match(rows[0].message as string, /Missing Permissions/);
  });

  await test('publishWeekThreads: re-publishing the same week adopts its own already-recorded threads and skips them', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    // The first call's creates write match_discord_state.thread_id for both matches, so the second
    // call's idempotency check is really exercising resolveExistingThreadId()'s id-first branch (the
    // titles happen to still match here too, but the id check runs first and wins).
    const { calls } = stubDiscord();
    const first = await publishWeekThreads(adminClient, 1, 1);
    assert.ok(!('error' in first));
    assert.deepEqual((first as Exclude<typeof first, { error: string }>).matches.map((m) => m.status), ['created', 'created']);

    const second = await publishWeekThreads(adminClient, 1, 1);
    assert.ok(!('error' in second));
    const ok = second as Exclude<typeof second, { error: string }>;
    assert.deepEqual(ok.matches.map((m) => m.status), ['skipped', 'skipped']);
    assert.equal(liveOpsErrors('match', 100, 'discord_thread_create').length, 1);
    assert.match(liveOpsErrors('match', 100, 'discord_thread_create')[0].message as string, /Already linked to thread/);

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
    assert.match(rows[0].message as string, /Already linked to thread/);
  });

  await test('publishWeekThreads: adopts a match\'s already-known thread by its recorded thread_id even though the thread was renamed since', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const db = buildFakeDb();
    // Match 100 (season 1, week 1) already points at a thread from a prior publish — the live thread's
    // current name no longer matches threadTitle()'s "Week 1 Game 1" output. A fresh db/client, not
    // the shared adminClient/fakeDb, since match 100/101/102 accumulate state across other tests.
    db.match_discord_state = [{ match_id: 100, thread_id: 'thread-renamed', event_id: null, message_checkpoint: null }];
    const client = createFakeSupabaseClient(db);
    __setTestClient(client);
    const { calls } = stubDiscord({
      existingThreads: [{ id: 'thread-renamed', name: 'Some Other Name', parent_id: 'channel-season-5' }],
    });

    const result = await publishWeekThreads(client, 1, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    const m100 = ok.matches.find((m) => m.matchId === 100)!;
    assert.equal(m100.title, 'Week 1 Game 1', 'the title in the result is the current format');
    assert.equal(m100.status, 'skipped');
    assert.equal(m100.detail, 'Already exists (thread thread-renamed)');

    // Match 101 has no known thread_id and no title match, so it creates a brand-new thread — that
    // one POST is expected and unrelated to what this test checks; match 100 must not get a second.
    const createCalls = calls.filter((c) => c.init?.method === 'POST');
    assert.equal(createCalls.length, 1, 'only match 101 creates a new thread; match 100 is adopted, not recreated');

    __setTestClient(adminClient);
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

  await test('publishWeekThreads: a match_discord_state write failure while adopting an existing thread is reported failed, not skipped', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    // Week 2 (season 1, week_id 11) has one match, 102 — "Week 2 Game 1". An admin already created
    // that exact thread by hand, same setup as the "adopts it" test above, but this time the
    // `match_discord_state` upsert that's supposed to record the adoption fails.
    stubDiscord({ existingThreads: [{ id: 'admin-thread-2', name: 'Week 2 Game 1', parent_id: 'channel-season-5' }] });
    const failingClient = withFailingUpsert(adminClient, 'match_discord_state', 'connection reset');
    const result = await publishWeekThreads(failingClient, 1, 2);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    assert.equal(ok.matches.length, 1);
    // Not 'skipped': the thread exists on Discord, but nothing was recorded to find it again later.
    assert.equal(ok.matches[0].status, 'failed');
    assert.match(ok.matches[0].detail, /Already linked to thread/);
    assert.match(ok.matches[0].detail, /connection reset/);

    const rows = liveOpsErrors('match', 102, 'discord_thread_create');
    assert.equal(rows.length, 1, 'the write-failure message must win over the routine "adopted" one');
    assert.match(rows[0].message as string, /connection reset/);
  });

  await test('publishWeekThreads: a match_discord_state write failure after creating a new thread is reported failed, and the row is not left half-written', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    // Week 1 (matches 100, 101) already has thread ids from an earlier test; this test's own
    // stubDiscord() instance has no existing threads, so Discord's idempotency check still finds
    // nothing and both matches go through the create path again.
    const before100 = await adminClient.from('match_discord_state').select('thread_id').eq('match_id', 100).maybeSingle();
    stubDiscord();
    const failingClient = withFailingUpsert(adminClient, 'match_discord_state', 'write timed out');
    const result = await publishWeekThreads(failingClient, 1, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    assert.deepEqual(ok.matches.map((m) => m.status), ['failed', 'failed']);
    assert.match(ok.matches[0].detail, /was created but recording match_discord_state failed/);
    assert.match(ok.matches[0].detail, /write timed out/);

    const rows = liveOpsErrors('match', 100, 'discord_thread_create');
    assert.equal(rows.length, 1);
    assert.match(rows[0].message as string, /write timed out/);

    // The failed upsert never touched the real table — match 100's prior thread_id is untouched.
    const after100 = await adminClient.from('match_discord_state').select('thread_id').eq('match_id', 100).maybeSingle();
    assert.deepEqual(after100.data, before100.data);
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

  await test('publishPodThreads: refuses a non-gauntlet season', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const result = await publishPodThreads(adminClient, 1, 1);
    assert.ok('error' in result);
    assert.match((result as { error: string }).error, /Not a gauntlet season/);
  });

  await test('publishPodThreads: one thread per pod, mentioning all 4 players across both games', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const db = podFakeDb();
    const client = createFakeSupabaseClient(db);
    __setTestClient(client);
    const { calls } = stubDiscord();

    const result = await publishPodThreads(client, 2, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    assert.equal(ok.seasonName, 'Season 5 Gauntlet');
    assert.equal(ok.roundNumber, 1);
    assert.equal(ok.pods.length, 1);
    assert.equal(ok.pods[0].status, 'created');
    assert.equal(ok.pods[0].title, 'GAUNTLET: Round 1 Group 1');

    const createCalls = calls.filter((c) => c.init?.method === 'POST');
    assert.equal(createCalls.length, 1, 'one thread for the whole pod, not one per game');
    const body = JSON.parse(createCalls[0].init?.body as string);
    assert.equal(body.name, 'GAUNTLET: Round 1 Group 1');
    // Game 1 (match 200): shirts Alice(1)+Bob(2) vs skins Erin(5)+Frank(6). Game 2 (match 201): shirts
    // Alice(1)+Erin(5) vs skins Bob(2)+Frank(6) — same 4 players, reshuffled. Each game gets its own
    // masked link, so Discord auto-unfurls both into separate preview cards; no manual embed is sent.
    assert.match(body.message.content, /Game 1: <@&role-alice> & <@&role-bob> vs Erin & Frank — \[Box Score\]\(https:\/\/dans-gaming-league-series\.vercel\.app\/matches\/200\)/);
    assert.match(body.message.content, /Game 2: <@&role-alice> & Erin vs <@&role-bob> & Frank — \[Box Score\]\(https:\/\/dans-gaming-league-series\.vercel\.app\/matches\/201\)/);
    assert.equal(body.message.embeds, undefined);

    // Both games point at the same thread.
    const state200 = await client.from('match_discord_state').select('thread_id').eq('match_id', 200).maybeSingle();
    const state201 = await client.from('match_discord_state').select('thread_id').eq('match_id', 201).maybeSingle();
    assert.ok((state200.data as { thread_id: string }).thread_id);
    assert.equal((state200.data as { thread_id: string }).thread_id, (state201.data as { thread_id: string }).thread_id);

    // Both games' rosters share the same 4 players reshuffled; only linked ones (Alice, Bob) are
    // explicitly added as thread members, deduped across the two games rather than added twice each.
    const threadId = (state200.data as { thread_id: string }).thread_id;
    const memberAddCalls = calls.filter((c) => c.init?.method === 'PUT' && c.url.startsWith(`https://discord.com/api/v10/channels/${threadId}/thread-members/`));
    assert.deepEqual(
      memberAddCalls.map((c) => c.url).sort(),
      [
        `https://discord.com/api/v10/channels/${threadId}/thread-members/discord-alice`,
        `https://discord.com/api/v10/channels/${threadId}/thread-members/discord-bob`,
      ],
    );

    __setTestClient(adminClient);
  });

  await test('publishPodThreads: adopts a pod\'s already-known thread by its recorded thread_id even though the thread was renamed since', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const db = podFakeDb();
    // Both games already point at a thread from a prior publish, back when podThreadTitle() produced
    // the old "Round 1 Pod 1" format — the live thread itself was since renamed (or never renamed at
    // all; either way its current name no longer matches what podThreadTitle() computes today).
    db.match_discord_state = [
      { match_id: 200, thread_id: 'thread-renamed', event_id: null, message_checkpoint: null },
      { match_id: 201, thread_id: 'thread-renamed', event_id: null, message_checkpoint: null },
    ];
    const client = createFakeSupabaseClient(db);
    __setTestClient(client);
    const { calls } = stubDiscord({
      existingThreads: [{ id: 'thread-renamed', name: 'Some Other Name', parent_id: 'channel-season-5' }],
    });

    const result = await publishPodThreads(client, 2, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    assert.equal(ok.pods[0].title, 'GAUNTLET: Round 1 Group 1', 'the title in the result is the current format');
    assert.equal(ok.pods[0].status, 'skipped');
    assert.equal(ok.pods[0].detail, 'Already exists (thread thread-renamed)');

    // Never touched — no thread-create POST was made despite the title not matching by name.
    assert.equal(calls.filter((c) => c.init?.method === 'POST').length, 0);

    __setTestClient(adminClient);
  });

  await test('publishPodThreads: a stale recorded thread_id (deleted or no longer live) falls back to the title match instead of being trusted blindly', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const db = podFakeDb();
    // A previously-recorded thread_id that no longer exists in the channel at all (deleted, or the
    // fixture never had one) — must not be trusted outright, or a genuinely missing thread would never
    // get (re-)created.
    db.match_discord_state = [
      { match_id: 200, thread_id: 'thread-deleted', event_id: null, message_checkpoint: null },
      { match_id: 201, thread_id: 'thread-deleted', event_id: null, message_checkpoint: null },
    ];
    const client = createFakeSupabaseClient(db);
    __setTestClient(client);
    const { calls } = stubDiscord(); // no existing threads at all

    const result = await publishPodThreads(client, 2, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    assert.equal(ok.pods[0].status, 'created', 'falls through to creating a real thread rather than trusting the dead id');

    assert.equal(calls.filter((c) => c.init?.method === 'POST').length, 1);

    __setTestClient(adminClient);
  });

  await test("publishPodThreads: 'next' sweeps every round, publishing finalized pods and skipping an unmaterialized sibling", async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const db = splitRoundFakeDb();
    const client = createFakeSupabaseClient(db);
    __setTestClient(client);
    stubDiscord();

    // Round 1 Pod 1 and Round 2 Pod 1 are both fully materialized and unpublished; Round 2 Pod 2 has
    // no matches yet — 'next' publishes both ready pods across the two different rounds in one call
    // and never mentions the unready one at all.
    const result = await publishPodThreads(client, 2, 'next');
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    assert.equal(ok.roundNumber, null, 'no single round header — this swept across rounds');
    assert.deepEqual(
      ok.pods.map((p) => [p.title, p.status]),
      [['GAUNTLET: Round 1 Group 1', 'created'], ['GAUNTLET: Round 2 Group 1', 'created']],
    );

    __setTestClient(adminClient);
  });

  await test("publishPodThreads: 'next' only reports newly-created threads, not pods already published", async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const db = splitRoundFakeDb();
    const client = createFakeSupabaseClient(db);
    __setTestClient(client);
    // Round 1 Pod 1's thread already exists in the channel (an earlier publish, or an admin's manual
    // create) — 'next' should adopt it silently rather than re-reporting it, since only Round 2 Pod 1
    // is actually new.
    stubDiscord({ existingThreads: [{ id: 'thread-existing', name: 'GAUNTLET: Round 1 Group 1', parent_id: 'channel-season-5' }] });

    const result = await publishPodThreads(client, 2, 'next');
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    assert.deepEqual(ok.pods.map((p) => p.title), ['GAUNTLET: Round 2 Group 1']);
    assert.equal(ok.pods[0].status, 'created');

    __setTestClient(adminClient);
  });

  await test("publishPodThreads: 'next' errors when nothing is newly finalized", async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const db = podFakeDb();
    const client = createFakeSupabaseClient(db);
    __setTestClient(client);
    stubDiscord({ existingThreads: [{ id: 'thread-existing', name: 'GAUNTLET: Round 1 Group 1', parent_id: 'channel-season-5' }] });

    const result = await publishPodThreads(client, 2, 'next');
    assert.deepEqual(result, { error: 'No newly finalized pods to publish' });

    __setTestClient(adminClient);
  });

  await test('publishPodThreads: an explicit round number still targets only that round, silently omitting a pod with zero materialized games', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const db = splitRoundFakeDb();
    const client = createFakeSupabaseClient(db);
    __setTestClient(client);
    stubDiscord();

    const result = await publishPodThreads(client, 2, 2);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    assert.equal(ok.roundNumber, 2);
    // Pod 2 has zero materialized matches, so it's absent from `matches` entirely and never appears
    // here at all — `matches.length !== 2` only fires for a pod caught mid-materialization (below).
    assert.equal(ok.pods.length, 1);
    assert.equal(ok.pods[0].title, 'GAUNTLET: Round 2 Group 1');
    assert.equal(ok.pods[0].status, 'created');

    __setTestClient(adminClient);
  });

  await test('publishPodThreads: an explicit round number reports a pod stuck with only one materialized game as failed', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const db = splitRoundFakeDb();
    // Pod 2 (round 2, pod_index 1) gets Game 1 only — a pod caught mid-materialization, unlike its
    // zero-games state in the base fixture.
    db.matches = [...db.matches, { ...db.matches.find((m) => m.id === 210)!, id: 212, week_id: 15, match_number: 3 }];
    db.gauntlet_pods = db.gauntlet_pods.map((p) => (p.id === 1003 ? { ...p, match1_id: 212 } : p));
    const client = createFakeSupabaseClient(db);
    __setTestClient(client);
    stubDiscord();

    const result = await publishPodThreads(client, 2, 2);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    assert.deepEqual(
      ok.pods.map((p) => [p.title, p.status]),
      [['GAUNTLET: Round 2 Group 1', 'created'], ['GAUNTLET: Round 2 Group 2', 'failed']],
    );
    assert.equal(ok.pods[1].detail, 'Pod is not fully materialized (expected 2 games)');

    __setTestClient(adminClient);
  });

  await test('closeGauntletPodThreadIfDone: does not close after only Game 1 is scored', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const db = podFakeDb();
    const client = createFakeSupabaseClient(db);
    __setTestClient(client);
    stubDiscord();
    await publishPodThreads(client, 2, 1);

    // Game 1 (200) is already played ('13-11') in the fixture; Game 2 (201) stays unplayed.
    const { calls } = stubDiscordClose();
    await closeGauntletPodThreadIfDone(client, 200);
    assert.equal(calls.length, 0, 'the pod thread must stay open until both games are played');

    __setTestClient(adminClient);
  });

  await test('closeGauntletPodThreadIfDone: closes the shared thread once both games are played', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const db = podFakeDb();
    db.matches = db.matches.map((m) => (m.id === 201 ? { ...m, final_score: '13-8' } : m));
    const client = createFakeSupabaseClient(db);
    __setTestClient(client);
    stubDiscord();
    await publishPodThreads(client, 2, 1);
    const { data } = await client.from('match_discord_state').select('thread_id').eq('match_id', 200).maybeSingle();
    const threadId = (data as { thread_id: string }).thread_id;

    const { calls } = stubDiscordClose();
    await closeGauntletPodThreadIfDone(client, 201);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://discord.com/api/v10/channels/${threadId}`);
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), { archived: true, locked: true });

    __setTestClient(adminClient);
  });

  await test('closeGauntletPodThreadIfDone: no-ops for a match with no resolvable pod', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    const { calls } = stubDiscordClose();
    await closeGauntletPodThreadIfDone(adminClient, 100); // non-gauntlet match
    assert.equal(calls.length, 0);
  });

  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_GUILD_ID;
  report();
}

await main();
