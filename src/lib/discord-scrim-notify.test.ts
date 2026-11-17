/**
 * Unit tests for discord-scrim-notify.ts's scrim night messages: the announcement (a plain link, or
 * straight to the night message when the night is under an hour out), the night message an hour out
 * (replacing the announcement, once), the roster with Definite/Maybe emoji, the latest match's running
 * and final score until the next match starts, the final standings once the night has ended
 * (including a reopen), message deletion when a night is removed, and the no-throw/no-webhook
 * guarantees.
 *
 * Run:  npx vitest run src/lib/discord-scrim-notify.test.ts
 */

import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createFakeSupabaseClient, type FakeDb, type Row } from './test-support/fakeSupabase';
import { scrimNightStartingIn } from './test-support/scrimFixtures';
import { test, report } from './test-support/miniTest';
import {
  deleteScrimNightMessages,
  getScrimNightMessageIds,
  notifyScrimMatchProgress,
  notifyScrimNightReminder,
  notifyScrimNightScheduled,
  scheduleScrimNightReminder,
  syncScrimNightMessage,
} from './discord-scrim-notify';

const NIGHT_ID = 5;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const WEBHOOK = 'https://discord.example/webhook';

interface Embed { title: string; description: string; url: string; color: number; fields: { name: string; value: string }[] }
interface FetchCall {
  url: string;
  method: string;
  body: { content: string; embeds: Embed[] } | null;
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

const signup = (playerId: number, commitment: string, checkedIn = false): Row => ({
  id: playerId, night_id: NIGHT_ID, player_id: playerId, commitment, signed_up_at: `2026-01-01T00:0${playerId}:00Z`, checked_in_at: checkedIn ? '2026-01-01T01:00:00Z' : null,
});
const stat = (id: number, matchId: number, playerId: number, faction: string, won: boolean): Row => ({
  id, match_id: matchId, player_id: playerId, faction, kills: 10, assists: 0, deaths: 8, damage: 1500, adr: 75, rounds_played: 20, rounds_won: won ? 13 : 7, is_win: won,
});
const scrimMatch = (id: number, matchNumber: number, finalScore: string | null): Row => ({
  id, week_id: null, scrim_night_id: NIGHT_ID, match_number: matchNumber, scrim_revision: 1, shirts_pick: 'Foroglio', skins_starting_side: null, final_score: finalScore,
});
const serverState = (matchId: number, server_state: string): Row => ({ match_id: matchId, server_state });
const liveScore = (matchId: number, shirts: number, skins: number, round: number): Row => ({ match_id: matchId, shirts_score: shirts, skins_score: skins, round, updated_at: '2026-01-01T00:00:00Z' });
const state = (extra: Row = {}): Row => ({ night_id: NIGHT_ID, announcement_message_id: null, reminder_message_id: null, reminder_sent_at: null, finalized_at: null, ...extra });

/** A night starting `startsInMs` from now with Ann and Cy definite and Bob maybe. */
function fixture(startsInMs: number, extra: Partial<FakeDb> = {}) {
  const db: FakeDb = {
    players: [
      { id: 1, name: 'Ann', discord_name_role_id: '111', steam_avatar_url: null },
      { id: 2, name: 'Bob', discord_name_role_id: null, steam_avatar_url: null },
      { id: 3, name: 'Cy', discord_name_role_id: null, steam_avatar_url: null },
      { id: 4, name: 'Di', discord_name_role_id: null, steam_avatar_url: null },
    ],
    scrim_nights: [scrimNightStartingIn(startsInMs, NIGHT_ID)],
    scrim_signups: [signup(1, 'definite'), signup(2, 'maybe'), signup(3, 'definite')],
    scrim_night_discord_state: [],
    matches: [],
    player_match_stats: [],
    match_server_state: [],
    live_match_score: [],
    ...extra,
  };
  return { db, client: createFakeSupabaseClient(db, { schedule_scrim_night_reminder: () => true }) };
}

/** `fixture()` for a night that is underway, with the night message already posted. */
function underway(extra: Partial<FakeDb> = {}) {
  return fixture(-10 * MIN, { scrim_night_discord_state: [state({ reminder_message_id: 'night', reminder_sent_at: '2026-01-01T00:00:00Z' })], ...extra });
}

const roster = (call: FetchCall) => call.body!.embeds[0].fields.find((f) => f.name.startsWith('Roster'))!.value;
const matchField = (call: FetchCall) => call.body!.embeds[0].fields.find((f) => f.name.startsWith('Match'));
/** `client` where recording a message id on the night's state row fails, as the foreign key does once
 *  the night has been removed. */
function failingIdStore(client: SupabaseClient): SupabaseClient {
  return new Proxy(client, {
    get(target, prop) {
      if (prop !== 'from') return Reflect.get(target, prop);
      return (table: string) => {
        const builder = target.from(table);
        if (table !== 'scrim_night_discord_state') return builder;
        return new Proxy(builder, {
          get(b, p) {
            const member = Reflect.get(b, p);
            if (p !== 'upsert') return typeof member === 'function' ? member.bind(b) : member;
            return (row: Row, opts: unknown) => {
              if ('reminder_message_id' in row || row.announcement_message_id) throw new Error('foreign key violation');
              return (member as (row: Row, opts: unknown) => unknown).call(b, row, opts);
            };
          },
        });
      };
    },
  });
}
/** Runs `fn` with console.error captured instead of printed, and returns what was logged. */
async function captureErrors(fn: () => Promise<unknown>): Promise<unknown[][]> {
  const logged: unknown[][] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    await fn();
  } finally {
    console.error = realError;
  }
  return logged;
}
const withWebhook = () => void (process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = WEBHOOK);

async function main() {
  await test('notifyScrimNightScheduled: posts the announcement embed with the roster and counts, tags no one, and stores its id', async () => {
    withWebhook();
    const { db, client } = fixture(5 * HOUR);
    const calls = stubFetch();
    await notifyScrimNightScheduled(client, NIGHT_ID);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].body!.content, '', 'no mentions on the announcement');
    const embed = calls[0].body!.embeds[0];
    assert.match(embed.description, /Scrim night scheduled/);
    assert.doesNotMatch(embed.description, /starting/i, 'no countdown yet');
    assert.ok(embed.url.endsWith(`/scrims/${NIGHT_ID}`));
    assert.equal(embed.fields[0].name, 'Roster (3) · 2 definite · 1 maybe · 0 checked in');
    assert.equal(roster(calls[0]), '✔️ Ann\n✔️ Cy\n❔ Bob');
    assert.deepEqual(db.scrim_night_discord_state.map((r) => [r.night_id, r.announcement_message_id, r.reminder_message_id]), [[NIGHT_ID, 'msg-1', undefined]]);
  });

  await test('notifyScrimNightScheduled: a night under an hour out gets the night message straight away, no announcement', async () => {
    withWebhook();
    const { db, client } = fixture(30 * MIN);
    const calls = stubFetch();
    await notifyScrimNightScheduled(client, NIGHT_ID);

    assert.deepEqual(calls.map((c) => c.method), ['POST']);
    assert.equal(roster(calls[0]), '✔️ Ann\n✔️ Cy\n❔ Bob');
    assert.equal(db.scrim_night_discord_state[0].reminder_message_id, 'msg-1');
    assert.ok(!db.scrim_night_discord_state[0].announcement_message_id);
  });

  await test('every export is a no-op without a webhook URL', async () => {
    delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
    const { db, client } = fixture(30 * MIN);
    const calls = stubFetch();
    await notifyScrimNightScheduled(client, NIGHT_ID);
    await syncScrimNightMessage(client, NIGHT_ID);
    await notifyScrimNightReminder(client, NIGHT_ID);
    await notifyScrimMatchProgress(client, 900);
    await scheduleScrimNightReminder(client, NIGHT_ID, new Date().toISOString());
    assert.equal(calls.length, 0);
    assert.equal(db.scrim_night_discord_state.length, 0);
  });

  await test('notifyScrimNightReminder: posts the night message, deletes the announcement, once', async () => {
    withWebhook();
    const { db, client } = fixture(55 * MIN, { scrim_night_discord_state: [state({ announcement_message_id: 'ann' })] });
    const calls = stubFetch();
    await notifyScrimNightReminder(client, NIGHT_ID);
    await notifyScrimNightReminder(client, NIGHT_ID);

    assert.deepEqual(calls.map((c) => [c.method, c.url]), [['DELETE', `${WEBHOOK}/messages/ann`], ['POST', `${WEBHOOK}?wait=true`]], 'the announcement goes before the night message is posted; the second call finds it claimed');
    const embed = calls[1].body!.embeds[0];
    assert.match(embed.description, /Scrim starting <t:\d+:R>!/);
    assert.doesNotMatch(embed.description, /scheduled/);
    assert.ok(embed.description.includes(`/scrims/${NIGHT_ID}`), 'links the night');
    assert.ok(embed.url.endsWith(`/scrims/${NIGHT_ID}`));
    assert.equal(roster(calls[1]), '✔️ Ann\n✔️ Cy\n❔ Bob', 'definite ✔️, maybe ❔');
    assert.equal(calls[1].body!.content, 'Definite: <@&111> **Cy**\nMaybe: **Bob**');
    const row = db.scrim_night_discord_state[0];
    assert.deepEqual([row.reminder_message_id, row.announcement_message_id], ['msg-1', null]);
    assert.ok(row.reminder_sent_at);
  });

  await test('notifyScrimNightReminder: seeds a state row when the announcement never posted', async () => {
    withWebhook();
    const { db, client } = fixture(55 * MIN);
    const calls = stubFetch();
    await notifyScrimNightReminder(client, NIGHT_ID);
    assert.deepEqual(calls.map((c) => c.method), ['POST']);
    assert.equal(db.scrim_night_discord_state[0].reminder_message_id, 'msg-1');
  });

  await test('notifyScrimNightReminder: skips a start outside the window, a started night, an ended night and a missing one', async () => {
    withWebhook();
    const calls = stubFetch();
    for (const startsIn of [5 * HOUR, -10 * MIN]) await notifyScrimNightReminder(fixture(startsIn).client, NIGHT_ID);
    const ended = fixture(HOUR);
    ended.db.scrim_nights[0].ended_at = new Date().toISOString();
    await notifyScrimNightReminder(ended.client, NIGHT_ID);
    await notifyScrimNightReminder(fixture(HOUR).client, 999);
    assert.equal(calls.length, 0);
  });

  await test('syncScrimNightMessage: edits the roster in place once the night message exists', async () => {
    withWebhook();
    const { client } = fixture(50 * MIN, { scrim_night_discord_state: [state({ reminder_message_id: 'night', reminder_sent_at: '2026-01-01T00:00:00Z' })] });
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.deepEqual(calls.map((c) => [c.method, c.url]), [['PATCH', `${WEBHOOK}/messages/night`]]);
    assert.equal(roster(calls[0]), '✔️ Ann\n✔️ Cy\n❔ Bob');
  });

  await test('syncScrimNightMessage: edits the announcement\'s roster in place before the night message is due', async () => {
    withWebhook();
    const { db, client } = fixture(5 * HOUR, { scrim_night_discord_state: [state({ announcement_message_id: 'ann' })] });
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.deepEqual(calls.map((c) => [c.method, c.url]), [['PATCH', `${WEBHOOK}/messages/ann`]]);
    assert.equal(calls[0].body!.content, '', 'still no mentions');
    assert.match(calls[0].body!.embeds[0].description, /Scrim night scheduled/);

    db.scrim_signups.push(signup(4, 'maybe'));
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.equal(calls[1].body!.embeds[0].fields[0].name, 'Roster (4) · 2 definite · 2 maybe · 0 checked in');
  });

  await test('syncScrimNightMessage: does nothing before the night message is due when no announcement is on record', async () => {
    withWebhook();
    const { client } = fixture(5 * HOUR);
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.equal(calls.length, 0);
  });

  await test('syncScrimNightMessage: posts the night message for a due night that has none (a reminder job that never fired)', async () => {
    withWebhook();
    const { db, client } = fixture(-10 * MIN, { scrim_night_discord_state: [state({ announcement_message_id: 'ann' })] });
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.deepEqual(calls.map((c) => c.method), ['DELETE', 'POST']);
    assert.equal(db.scrim_night_discord_state[0].reminder_message_id, 'msg-1');
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.deepEqual(calls.map((c) => c.method), ['DELETE', 'POST', 'PATCH'], 'then edits it');
  });

  await test('syncScrimNightMessage: shows a live match with its score and a link, then its final score', async () => {
    withWebhook();
    const { db, client } = underway({ matches: [scrimMatch(900, 1, null)], match_server_state: [serverState(900, 'live')], live_match_score: [liveScore(900, 7, 5, 12)] });
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.equal(matchField(calls[0])!.name, 'Match 1 · Foroglio');
    assert.equal(matchField(calls[0])!.value, '🔴 **LIVE** 7-5 · Round 12\n[Match page](https://dans-gaming-league-series.vercel.app/scrims/matches/900)'.replace('https://dans-gaming-league-series.vercel.app', calls[0].body!.embeds[0].url.split('/scrims/')[0]));

    db.matches[0].final_score = '13-9';
    db.live_match_score = [];
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.match(matchField(calls[1])!.value, /^🏁 \*\*Final\*\* 13-9\n\[Match page\]\(.*\/scrims\/matches\/900\)$/);
  });

  await test('syncScrimNightMessage: the next match replaces the last final score once its server has started, not before', async () => {
    withWebhook();
    const { db, client } = underway({ matches: [scrimMatch(900, 1, '13-9'), scrimMatch(901, 2, null)], match_server_state: [serverState(900, 'done')] });
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.match(matchField(calls[0])!.name, /^Match 1/, 'match 2 is only queued');
    assert.match(matchField(calls[0])!.value, /Final/);

    db.match_server_state.push(serverState(901, 'provisioning'));
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.match(matchField(calls[1])!.name, /^Match 2/, 'the server claim replaces it');
    assert.match(matchField(calls[1])!.value, /Server starting/);

    db.match_server_state[1].server_state = 'live';
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.match(matchField(calls[2])!.value, /Server live/);

    db.live_match_score = [liveScore(901, 1, 0, 1)];
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.match(matchField(calls[3])!.value, /LIVE\*\* 1-0 · Round 1/);
  });

  await test('syncScrimNightMessage: a failed server start does not replace the last match', async () => {
    withWebhook();
    const { client } = underway({ matches: [scrimMatch(900, 1, '13-9'), scrimMatch(901, 2, null)], match_server_state: [serverState(901, 'failed')] });
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.match(matchField(calls[0])!.name, /^Match 1/);
  });

  await test('syncScrimNightMessage: a match whose game is over but has no score yet awaits its result', async () => {
    withWebhook();
    const { client } = underway({ matches: [scrimMatch(900, 1, null)], match_server_state: [serverState(900, 'tearing_down')] });
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.match(matchField(calls[0])!.value, /Awaiting the result/);
  });

  await test('syncScrimNightMessage: no match field before any match has started', async () => {
    withWebhook();
    const { client } = underway({ matches: [scrimMatch(900, 1, null)] });
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.equal(matchField(calls[0]), undefined);
  });

  await test('a failed night-message post gives the claim back, so the next sync posts it', async () => {
    withWebhook();
    const { db, client } = fixture(55 * MIN, { scrim_night_discord_state: [state({ announcement_message_id: 'ann' })] });
    const logged = await captureErrors(async () => {
    // The announcement's delete succeeds; the night message's post fails.
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (_url: string, init?: RequestInit) => {
      const ok = init?.method === 'DELETE';
      return { ok, status: ok ? 204 : 500, json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;
    await notifyScrimNightReminder(client, NIGHT_ID);
    });
    assert.equal(logged.length, 1);
    assert.equal(db.scrim_night_discord_state[0].reminder_sent_at, null, 'claim released');

    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.deepEqual(calls.map((c) => c.method), ['DELETE', 'POST'], 'the announcement id was still on record, and deleting it again is harmless');
    assert.equal(db.scrim_night_discord_state[0].announcement_message_id, null, 'cleared once the night message is stored');
    assert.equal(db.scrim_night_discord_state[0].reminder_message_id, 'msg-1');
  });

  await test('a failed announcement delete posts nothing and gives the claim back', async () => {
    withWebhook();
    const { db, client } = fixture(55 * MIN, { scrim_night_discord_state: [state({ announcement_message_id: 'ann' })] });
    const calls = stubFetch(500);
    await captureErrors(async () => {
    await notifyScrimNightReminder(client, NIGHT_ID);
    });
    assert.deepEqual(calls.map((c) => c.method), ['DELETE'], 'no night message while the announcement is up');
    assert.equal(db.scrim_night_discord_state[0].reminder_sent_at, null, 'claim released');
    assert.equal(db.scrim_night_discord_state[0].announcement_message_id, 'ann');

    const retry = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.deepEqual(retry.map((c) => c.method), ['DELETE', 'POST'], 'the next sync deletes then posts');
  });

  await test('a post that returns no message id gives the claim back', async () => {
    withWebhook();
    const { db, client } = fixture(55 * MIN, { scrim_night_discord_state: [state({ announcement_message_id: 'ann' })] });
    const calls: string[] = [];
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (_url: string, init?: RequestInit) => {
      calls.push(init?.method ?? 'GET');
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;
    await captureErrors(async () => {
    await notifyScrimNightReminder(client, NIGHT_ID);
    });
    assert.deepEqual(calls, ['DELETE', 'POST']);
    assert.equal(db.scrim_night_discord_state[0].reminder_sent_at, null);
    assert.equal(db.scrim_night_discord_state[0].reminder_message_id ?? null, null);
  });

  await test('the roster marks who has checked in with ✅ and counts them, 0 included', async () => {
    withWebhook();
    const { db, client } = fixture(40 * MIN, { scrim_night_discord_state: [state({ reminder_message_id: 'night', reminder_sent_at: '2026-01-01T00:00:00Z' })] });
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.ok(calls[0].body!.embeds[0].fields[0].name.endsWith('· 0 checked in'));
    assert.equal(roster(calls[0]), '✔️ Ann\n✔️ Cy\n❔ Bob', 'no ✅ before anyone checks in');

    db.scrim_signups[2].checked_in_at = '2026-01-01T01:00:00Z';
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.ok(calls[1].body!.embeds[0].fields[0].name.endsWith('· 1 checked in'));
    assert.equal(roster(calls[1]), '✔️ Ann\n✅ Cy\n❔ Bob');
  });

  await test('an announcement whose night is removed while it posts is deleted again', async () => {
    withWebhook();
    const { client } = fixture(5 * HOUR);
    const calls = stubFetch();
    await captureErrors(async () => {
    // Storing the id fails, as the foreign key does once the night is gone.
    await notifyScrimNightScheduled(failingIdStore(client), NIGHT_ID);
    });
    assert.deepEqual(calls.map((c) => [c.method, c.url]), [['POST', `${WEBHOOK}?wait=true`], ['DELETE', `${WEBHOOK}/messages/msg-1`]]);
  });

  await test('a night message whose night is removed while it posts is deleted again', async () => {
    withWebhook();
    const { db, client } = fixture(55 * MIN, { scrim_night_discord_state: [state()] });
    const calls = stubFetch();
    await captureErrors(() => notifyScrimNightReminder(failingIdStore(client), NIGHT_ID));
    assert.deepEqual(calls.map((c) => [c.method, c.url]), [['POST', `${WEBHOOK}?wait=true`], ['DELETE', `${WEBHOOK}/messages/msg-1`]]);
    assert.equal(db.scrim_night_discord_state[0].reminder_sent_at, null, 'the claim is given back, so a retry posts it fresh');
  });

  await test('an ended night with only its announcement has the announcement edited to over', async () => {
    withWebhook();
    const { db, client } = fixture(-HOUR, { scrim_night_discord_state: [state({ announcement_message_id: 'ann' })] });
    db.scrim_nights[0].ended_at = new Date().toISOString();
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.deepEqual(calls.map((c) => [c.method, c.url]), [['PATCH', `${WEBHOOK}/messages/ann`]]);
    assert.match(calls[0].body!.embeds[0].description, /Scrim night over/);
  });

  await test('an announcement deleted from the channel is forgotten without an error, and not edited again', async () => {
    withWebhook();
    const { db, client } = fixture(5 * HOUR, { scrim_night_discord_state: [state({ announcement_message_id: 'ann' })] });
    const calls = stubFetch(404);
    const logged = await captureErrors(() => syncScrimNightMessage(client, NIGHT_ID));
    assert.equal(logged.length, 0);
    assert.equal(db.scrim_night_discord_state[0].announcement_message_id, null);
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.equal(calls.length, 1, 'no further edits');
  });

  await test('a night message deleted from the channel is logged and left alone', async () => {
    withWebhook();
    const { db, client } = underway();
    stubFetch(404);
    const logged = await captureErrors(() => syncScrimNightMessage(client, NIGHT_ID));
    assert.equal(logged.length, 1);
    assert.equal(db.scrim_night_discord_state[0].reminder_message_id, 'night', 'no re-post');
  });

  await test('a long roster is cut to Discord\'s field limit with a "+N more" tail, and the content to its own', async () => {
    withWebhook();
    const names = Array.from({ length: 160 }, (_, i) => `Player-with-a-long-name-${i}`);
    const { client } = fixture(55 * MIN, {
      players: names.map((name, i) => ({ id: 100 + i, name, discord_name_role_id: `9000000000000${String(i).padStart(5, '0')}`, steam_avatar_url: null })),
      scrim_signups: names.map((_, i) => ({ id: i, night_id: NIGHT_ID, player_id: 100 + i, commitment: i % 2 ? 'maybe' : 'definite', signed_up_at: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`, checked_in_at: null })),
    });
    const calls = stubFetch();
    await notifyScrimNightReminder(client, NIGHT_ID);
    assert.ok(roster(calls[0]).length <= 1024);
    assert.match(roster(calls[0]), /\+\d+ more$/);
    assert.ok(calls[0].body!.content.length <= 2000);
    assert.match(calls[0].body!.content, /\+\d+ more/);
  });

  await test('a player name with backticks cannot close the standings code block', async () => {
    withWebhook();
    const { db, client } = underway({
      matches: [scrimMatch(900, 1, '13-9')],
      player_match_stats: [stat(1, 900, 1, 'SHIRTS', true), stat(2, 900, 3, 'SHIRTS', true), stat(3, 900, 2, 'SKINS', false), stat(4, 900, 4, 'SKINS', false)],
    });
    db.players[0].name = 'A```nn';
    db.scrim_nights[0].ended_at = new Date().toISOString();
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    const standings = calls[0].body!.embeds[0].fields.find((f) => f.name === 'Final standings')!.value;
    assert.equal(standings.split('```').length, 3, 'only the opening and closing fence');
  });

  await test('syncScrimNightMessage: an ended night shows its standings in place of the last match, once', async () => {
    withWebhook();
    const { db, client } = underway({
      matches: [scrimMatch(900, 1, '13-9')],
      player_match_stats: [stat(1, 900, 1, 'SHIRTS', true), stat(2, 900, 3, 'SHIRTS', true), stat(3, 900, 2, 'SKINS', false), stat(4, 900, 4, 'SKINS', false)],
    });
    db.scrim_nights[0].ended_at = new Date().toISOString();
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    await syncScrimNightMessage(client, NIGHT_ID);

    assert.equal(calls.length, 1, 'finalized once');
    const fields = calls[0].body!.embeds[0].fields;
    assert.equal(matchField(calls[0]), undefined, 'the last match is gone');
    const standings = fields.find((f) => f.name === 'Final standings')!.value;
    assert.match(standings, /W-L/);
    assert.match(standings, / 1 {2}(Ann|Cy) +1-0/);
    assert.match(standings, / 3 {2}(Bob|Di) +0-1/);
    assert.match(calls[0].body!.embeds[0].description, /Scrim night over/);
    assert.ok(db.scrim_night_discord_state[0].finalized_at);
  });

  await test('syncScrimNightMessage: a reopened night goes back to its latest match', async () => {
    withWebhook();
    const { db, client } = underway({ matches: [scrimMatch(900, 1, '13-9')] });
    db.scrim_night_discord_state[0].finalized_at = '2026-01-01T00:00:00Z';
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.equal(calls.length, 1);
    assert.match(matchField(calls[0])!.value, /Final/);
    assert.equal(db.scrim_night_discord_state[0].finalized_at, null);
  });

  await test('syncScrimNightMessage: leaves a night that is gone, and a message deleted from the channel, alone', async () => {
    withWebhook();
    const calls = stubFetch();
    await syncScrimNightMessage(underway().client, 999);
    assert.equal(calls.length, 0);

    const logged = await captureErrors(async () => {
    stubFetch(404);
    await syncScrimNightMessage(underway().client, NIGHT_ID);
    });
    assert.equal(logged.length, 1, 'logged, and no replacement posted');
  });

  await test('notifyScrimMatchProgress: syncs the night of a scrim match; a league match is a no-op', async () => {
    withWebhook();
    const { client } = underway({ matches: [scrimMatch(900, 1, null), { id: 100, week_id: 1, scrim_night_id: null, match_number: 1, final_score: null }], match_server_state: [serverState(900, 'live')], live_match_score: [liveScore(900, 1, 0, 1)] });
    const calls = stubFetch();
    await notifyScrimMatchProgress(client, 100);
    await notifyScrimMatchProgress(client, 12345);
    assert.equal(calls.length, 0);
    await notifyScrimMatchProgress(client, 900);
    assert.deepEqual(calls.map((c) => c.method), ['PATCH']);
  });

  await test('a failed webhook post is logged, never thrown, and leaves nothing stored', async () => {
    withWebhook();
    const { db, client } = fixture(5 * HOUR);
    stubFetch(500);
    const logged = await captureErrors(async () => {
    await notifyScrimNightScheduled(client, NIGHT_ID);
    });
    assert.equal(logged.length, 1);
    assert.equal(db.scrim_night_discord_state.length, 0);
  });

  await test('getScrimNightMessageIds + deleteScrimNightMessages: removes both messages, and a 404 counts as deleted', async () => {
    withWebhook();
    const { client } = fixture(5 * HOUR, { scrim_night_discord_state: [state({ announcement_message_id: 'ann', reminder_message_id: 'night' })] });
    const ids = await getScrimNightMessageIds(client, NIGHT_ID);
    assert.deepEqual(ids, ['ann', 'night']);
    const calls = stubFetch(404);
    const logged = await captureErrors(async () => {
    await deleteScrimNightMessages(NIGHT_ID, ids);
    });
    assert.deepEqual(calls.map((c) => [c.method, c.url]), [['DELETE', `${WEBHOOK}/messages/ann`], ['DELETE', `${WEBHOOK}/messages/night`]]);
    assert.equal(logged.length, 0);
    assert.deepEqual(await getScrimNightMessageIds(fixture(HOUR).client, NIGHT_ID), []);
  });

  await test('scheduleScrimNightReminder: calls the RPC with the night and its start; a refused schedule is logged', async () => {
    withWebhook();
    const args: unknown[] = [];
    const db: FakeDb = { scrim_nights: [] };
    const ok = createFakeSupabaseClient(db, { schedule_scrim_night_reminder: (a) => (args.push(a), true) });
    await scheduleScrimNightReminder(ok, NIGHT_ID, '2026-12-01T01:00:00.000Z');
    assert.deepEqual(args, [{ p_night_id: NIGHT_ID, p_starts_at: '2026-12-01T01:00:00.000Z' }]);

    const refused = createFakeSupabaseClient(db, { schedule_scrim_night_reminder: () => false });
    const logged = await captureErrors(async () => {
    await scheduleScrimNightReminder(refused, NIGHT_ID, '2026-12-01T01:00:00.000Z');
    });
    assert.equal(logged.length, 1);
  });

  report();
}

await main();
