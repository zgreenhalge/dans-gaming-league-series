/**
 * Unit tests for discord-scrim-notify.ts's scrim night announcements: the announcement posted when a
 * night starts, the roster edited in place (Definite/Maybe, check-in marks) on every change, the
 * starting message at the start (once, inside its window, never for an ended night), message deletion when a
 * night is removed, and the no-throw/no-webhook guarantees.
 *
 * Run:  npx vitest run src/lib/discord-scrim-notify.test.ts
 */

import assert from 'node:assert/strict';
import { createFakeSupabaseClient, type FakeDb, type Row } from './test-support/fakeSupabase';
import { scrimNightStartingIn } from './test-support/scrimFixtures';
import { test, report } from './test-support/miniTest';
import {
  deleteScrimNightMessages,
  getScrimNightMessageIds,
  notifyScrimNightStarting,
  notifyScrimNightScheduled,
  scheduleScrimNightStart,
  syncScrimNightRoster,
} from './discord-scrim-notify';

const NIGHT_ID = 5;
const HOUR = 60 * 60 * 1000;
const WEBHOOK = 'https://discord.example/webhook';

interface FetchCall {
  url: string;
  method: string;
  body: { content: string; embeds: { title: string; description: string; url: string; fields: { name: string; value: string }[] }[] } | null;
}

function stubFetch(status = 200): FetchCall[] {
  const calls: FetchCall[] = [];
  let counter = 0;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : null });
    const ok = status >= 200 && status < 300;
    return { ok, status, json: async () => ({ id: `msg-${++counter}` }) } as unknown as Response;
  }) as typeof fetch;
  return calls;
}

const signup = (playerId: number, commitment: string, extra: Row = {}): Row => ({
  id: playerId, night_id: NIGHT_ID, player_id: playerId, commitment, signed_up_at: `2026-01-01T00:0${playerId}:00Z`, checked_in_at: null, ...extra,
});

function fixture(startsInMs: number, extra: Partial<FakeDb> = {}) {
  const db: FakeDb = {
    players: [
      { id: 1, name: 'Ann', discord_name_role_id: '111' },
      { id: 2, name: 'Bob', discord_name_role_id: null },
      { id: 3, name: 'Cy', discord_name_role_id: null },
    ],
    scrim_nights: [scrimNightStartingIn(startsInMs, NIGHT_ID)],
    scrim_signups: [signup(1, 'definite'), signup(2, 'maybe'), signup(3, 'definite', { checked_in_at: '2026-01-01T01:00:00Z' })],
    scrim_night_discord_state: [],
    ...extra,
  };
  return { db, client: createFakeSupabaseClient(db, { schedule_scrim_night_start: () => true }) };
}

const field = (call: FetchCall, name: string) => call.body!.embeds[0].fields.find((f) => f.name.startsWith(name))!.value;

async function main() {
  await test('notifyScrimNightScheduled: posts the announcement with the roster and stores its id', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = WEBHOOK;
    const { db, client } = fixture(2 * HOUR);
    const calls = stubFetch();
    await notifyScrimNightScheduled(client, NIGHT_ID);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.ok(calls[0].url.endsWith('?wait=true'));
    const embed = calls[0].body!.embeds[0];
    assert.match(embed.title, /^Scrim night · /);
    assert.match(embed.description, /Scrim night scheduled/);
    assert.ok(embed.url.endsWith(`/scrims/${NIGHT_ID}`));
    assert.equal(field(calls[0], 'Definite'), 'Ann\n✅ Cy', 'definite in signup order, a ✅ for a check-in');
    assert.equal(field(calls[0], 'Maybe'), 'Bob');
    assert.equal(calls[0].body!.content, 'Definite: <@&111> **Cy**\nMaybe: **Bob**', 'role tag when linked, bold name otherwise');
    assert.deepEqual(db.scrim_night_discord_state.map((r) => [r.night_id, r.announcement_message_id]), [[NIGHT_ID, 'msg-1']]);
  });

  await test('every export is a no-op without a webhook URL', async () => {
    delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
    const { db, client } = fixture(30 * 60 * 1000);
    const calls = stubFetch();
    await notifyScrimNightScheduled(client, NIGHT_ID);
    await syncScrimNightRoster(client, NIGHT_ID);
    await notifyScrimNightStarting(client, NIGHT_ID);
    await scheduleScrimNightStart(client, NIGHT_ID, new Date().toISOString());
    assert.equal(calls.length, 0);
    assert.equal(db.scrim_night_discord_state.length, 0);
  });

  await test('syncScrimNightRoster: edits the announcement and the starting message in place', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = WEBHOOK;
    const { client } = fixture(2 * HOUR, {
      scrim_night_discord_state: [{ night_id: NIGHT_ID, announcement_message_id: 'ann', starting_message_id: 'rem', starting_sent_at: null }],
    });
    const calls = stubFetch();
    await syncScrimNightRoster(client, NIGHT_ID);

    assert.deepEqual(calls.map((c) => [c.method, c.url]), [['PATCH', `${WEBHOOK}/messages/ann`], ['PATCH', `${WEBHOOK}/messages/rem`]]);
    assert.match(calls[0].body!.embeds[0].description, /scheduled/);
    assert.match(calls[1].body!.embeds[0].description, /starting/);
    assert.equal(field(calls[1], 'Maybe'), 'Bob');
  });

  await test('syncScrimNightRoster: posts a fresh announcement when none is on record or it cannot be edited', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = WEBHOOK;
    const none = fixture(2 * HOUR);
    let calls = stubFetch();
    await syncScrimNightRoster(none.client, NIGHT_ID);
    assert.deepEqual(calls.map((c) => c.method), ['POST']);
    assert.equal(none.db.scrim_night_discord_state[0].announcement_message_id, 'msg-1');

    const gone = fixture(2 * HOUR, { scrim_night_discord_state: [{ night_id: NIGHT_ID, announcement_message_id: 'old', starting_message_id: null, starting_sent_at: null }] });
    calls = [];
    const real = globalThis.fetch;
    let n = 0;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: null });
      const ok = init?.method !== 'PATCH';
      if (ok) n++;
      return { ok, status: ok ? 200 : 404, json: async () => ({ id: `new-${n}` }) } as unknown as Response;
    }) as typeof fetch;
    await syncScrimNightRoster(gone.client, NIGHT_ID);
    (globalThis as unknown as { fetch: typeof fetch }).fetch = real;
    assert.deepEqual(calls.map((c) => c.method), ['PATCH', 'POST']);
    assert.equal(gone.db.scrim_night_discord_state[0].announcement_message_id, 'new-1');
  });

  await test('syncScrimNightRoster: leaves an ended night, and a night that is gone, alone', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = WEBHOOK;
    const ended = fixture(-HOUR / 2);
    ended.db.scrim_nights[0].ended_at = new Date().toISOString();
    const calls = stubFetch();
    await syncScrimNightRoster(ended.client, NIGHT_ID);
    await syncScrimNightRoster(ended.client, 999);
    assert.equal(calls.length, 0);
  });

  await test('notifyScrimNightStarting: posts once at the start, stores the id, and is claimed', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = WEBHOOK;
    const { db, client } = fixture(-60 * 1000, {
      scrim_night_discord_state: [{ night_id: NIGHT_ID, announcement_message_id: 'ann', starting_message_id: null, starting_sent_at: null }],
    });
    const calls = stubFetch();
    await notifyScrimNightStarting(client, NIGHT_ID);
    await notifyScrimNightStarting(client, NIGHT_ID);

    assert.equal(calls.length, 1, 'the second call finds the starting message already claimed');
    assert.equal(calls[0].method, 'POST');
    assert.match(calls[0].body!.embeds[0].description, /starting/);
    const state = db.scrim_night_discord_state[0];
    assert.equal(state.starting_message_id, 'msg-1');
    assert.equal(state.announcement_message_id, 'ann', 'the announcement id is kept');
    assert.ok(state.starting_sent_at);
  });

  await test('notifyScrimNightStarting: seeds a state row when the announcement never posted', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = WEBHOOK;
    const { db, client } = fixture(-60 * 1000);
    const calls = stubFetch();
    await notifyScrimNightStarting(client, NIGHT_ID);
    assert.equal(calls.length, 1);
    assert.equal(db.scrim_night_discord_state[0].starting_message_id, 'msg-1');
  });

  await test('notifyScrimNightStarting: skips a start outside the window either side, an ended night and a missing one', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = WEBHOOK;
    const calls = stubFetch();
    for (const startsIn of [5 * HOUR, -2 * HOUR]) {
      await notifyScrimNightStarting(fixture(startsIn).client, NIGHT_ID);
    }
    const ended = fixture(-60 * 1000);
    ended.db.scrim_nights[0].ended_at = new Date().toISOString();
    await notifyScrimNightStarting(ended.client, NIGHT_ID);
    await notifyScrimNightStarting(fixture(HOUR).client, 999);
    assert.equal(calls.length, 0);
  });

  await test('a failed webhook post is logged, never thrown, and leaves nothing stored', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = WEBHOOK;
    const { db, client } = fixture(2 * HOUR);
    stubFetch(500);
    const logged: unknown[][] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      await notifyScrimNightScheduled(client, NIGHT_ID);
    } finally {
      console.error = realError;
    }
    assert.equal(logged.length, 1);
    assert.equal(db.scrim_night_discord_state.length, 0);
  });

  await test('getScrimNightMessageIds + deleteScrimNightMessages: removes both messages, and a 404 counts as deleted', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = WEBHOOK;
    const { client } = fixture(2 * HOUR, {
      scrim_night_discord_state: [{ night_id: NIGHT_ID, announcement_message_id: 'ann', starting_message_id: 'rem', starting_sent_at: null }],
    });
    const ids = await getScrimNightMessageIds(client, NIGHT_ID);
    assert.deepEqual(ids, ['ann', 'rem']);
    const calls = stubFetch(404);
    const realError = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      await deleteScrimNightMessages(NIGHT_ID, ids);
    } finally {
      console.error = realError;
    }
    assert.deepEqual(calls.map((c) => [c.method, c.url]), [['DELETE', `${WEBHOOK}/messages/ann`], ['DELETE', `${WEBHOOK}/messages/rem`]]);
    assert.equal(logged.length, 0);
    assert.deepEqual(await getScrimNightMessageIds(fixture(HOUR).client, NIGHT_ID), []);
  });

  await test('scheduleScrimNightStart: calls the RPC with the night and its start; a refused schedule is logged', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = WEBHOOK;
    const args: unknown[] = [];
    const db: FakeDb = { scrim_nights: [] };
    const ok = createFakeSupabaseClient(db, { schedule_scrim_night_start: (a) => (args.push(a), true) });
    await scheduleScrimNightStart(ok, NIGHT_ID, '2026-12-01T01:00:00.000Z');
    assert.deepEqual(args, [{ p_night_id: NIGHT_ID, p_starts_at: '2026-12-01T01:00:00.000Z' }]);

    const refused = createFakeSupabaseClient(db, { schedule_scrim_night_start: () => false });
    const logged: unknown[][] = [];
    const realError = console.error;
    console.error = (...a: unknown[]) => void logged.push(a);
    try {
      await scheduleScrimNightStart(refused, NIGHT_ID, '2026-12-01T01:00:00.000Z');
    } finally {
      console.error = realError;
    }
    assert.equal(logged.length, 1);
  });

  delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  report();
}

await main();
