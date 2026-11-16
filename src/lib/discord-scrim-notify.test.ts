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
import { createFakeSupabaseClient, type FakeDb, type Row } from './test-support/fakeSupabase';
import { idleFor, scrimNightStartingIn } from './test-support/scrimFixtures';
import { test, report } from './test-support/miniTest';
import {
  deleteScrimNightMessages,
  finalizeEndedScrimNights,
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

const signup = (playerId: number, commitment: string): Row => ({
  id: playerId, night_id: NIGHT_ID, player_id: playerId, commitment, signed_up_at: `2026-01-01T00:0${playerId}:00Z`, checked_in_at: null,
});
const stat = (id: number, matchId: number, playerId: number, faction: string, won: boolean): Row => ({
  id, match_id: matchId, player_id: playerId, faction, kills: 10, assists: 0, deaths: 8, damage: 1500, adr: 75, rounds_played: 20, rounds_won: won ? 13 : 7, is_win: won,
});
const scrimMatch = (id: number, matchNumber: number, finalScore: string | null): Row => ({
  id, week_id: null, scrim_night_id: NIGHT_ID, match_number: matchNumber, scrim_revision: 1, shirts_pick: 'Foroglio', skins_starting_side: null, final_score: finalScore,
});
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
const withWebhook = () => void (process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = WEBHOOK);

async function main() {
  await test('notifyScrimNightScheduled: posts a plain announcement with a link Discord can preview, and stores its id', async () => {
    withWebhook();
    const { db, client } = fixture(5 * HOUR);
    const calls = stubFetch();
    await notifyScrimNightScheduled(client, NIGHT_ID);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].body!.embeds, [], 'no embed, so the link unfurls');
    assert.match(calls[0].body!.content, /Scrim night scheduled/);
    assert.ok(calls[0].body!.content.endsWith(`/scrims/${NIGHT_ID}`));
    assert.deepEqual(db.scrim_night_discord_state.map((r) => [r.night_id, r.announcement_message_id, r.reminder_message_id]), [[NIGHT_ID, 'msg-1', undefined]]);
  });

  await test('notifyScrimNightScheduled: a night under an hour out gets the night message straight away, no announcement', async () => {
    withWebhook();
    const { db, client } = fixture(30 * MIN);
    const calls = stubFetch();
    await notifyScrimNightScheduled(client, NIGHT_ID);

    assert.deepEqual(calls.map((c) => c.method), ['POST']);
    assert.equal(roster(calls[0]), '✅ Ann\n✅ Cy\n❔ Bob');
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
    await finalizeEndedScrimNights(client);
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

    assert.deepEqual(calls.map((c) => [c.method, c.url]), [['POST', `${WEBHOOK}?wait=true`], ['DELETE', `${WEBHOOK}/messages/ann`]], 'the second call finds the message claimed');
    const embed = calls[0].body!.embeds[0];
    assert.match(embed.description, /Scrim night starts/);
    assert.ok(embed.description.includes(`/scrims/${NIGHT_ID}`), 'links the night');
    assert.ok(embed.url.endsWith(`/scrims/${NIGHT_ID}`));
    assert.equal(roster(calls[0]), '✅ Ann\n✅ Cy\n❔ Bob', 'definite ✅, maybe ❔');
    assert.equal(calls[0].body!.content, 'Definite: <@&111> **Cy**\nMaybe: **Bob**');
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
    assert.equal(roster(calls[0]), '✅ Ann\n✅ Cy\n❔ Bob');
  });

  await test('syncScrimNightMessage: leaves the announcement alone before the night message is due', async () => {
    withWebhook();
    const { client } = fixture(5 * HOUR, { scrim_night_discord_state: [state({ announcement_message_id: 'ann' })] });
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.equal(calls.length, 0);
  });

  await test('syncScrimNightMessage: posts the night message for a due night that has none (a reminder job that never fired)', async () => {
    withWebhook();
    const { db, client } = fixture(-10 * MIN, { scrim_night_discord_state: [state({ announcement_message_id: 'ann' })] });
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.deepEqual(calls.map((c) => c.method), ['POST', 'DELETE']);
    assert.equal(db.scrim_night_discord_state[0].reminder_message_id, 'msg-1');
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.deepEqual(calls.map((c) => c.method), ['POST', 'DELETE', 'PATCH'], 'then edits it');
  });

  await test('syncScrimNightMessage: shows a live match with its score and a link, then its final score', async () => {
    withWebhook();
    const { db, client } = underway({ matches: [scrimMatch(900, 1, null)], live_match_score: [liveScore(900, 7, 5, 12)] });
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.equal(matchField(calls[0])!.name, 'Match 1 · Foroglio');
    assert.equal(matchField(calls[0])!.value, '🔴 **LIVE** 7-5 · Round 12\n[Match page](https://dans-gaming-league-series.vercel.app/scrims/matches/900)'.replace('https://dans-gaming-league-series.vercel.app', calls[0].body!.embeds[0].url.split('/scrims/')[0]));

    db.matches[0].final_score = '13-9';
    db.live_match_score = [];
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.match(matchField(calls[1])!.value, /^🏁 \*\*Final\*\* 13-9\n\[Match page\]\(.*\/scrims\/matches\/900\)$/);
  });

  await test('syncScrimNightMessage: the next match replaces the last final score once it reports a score, not before', async () => {
    withWebhook();
    const { db, client } = underway({ matches: [scrimMatch(900, 1, '13-9'), scrimMatch(901, 2, null)] });
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.match(matchField(calls[0])!.name, /^Match 1/, 'match 2 is only queued');
    assert.match(matchField(calls[0])!.value, /Final/);

    db.live_match_score = [liveScore(901, 1, 0, 1)];
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.match(matchField(calls[1])!.name, /^Match 2/);
    assert.match(matchField(calls[1])!.value, /LIVE/);
  });

  await test('syncScrimNightMessage: no match field before any match has a score', async () => {
    withWebhook();
    const { client } = underway({ matches: [scrimMatch(900, 1, null)] });
    const calls = stubFetch();
    await syncScrimNightMessage(client, NIGHT_ID);
    assert.equal(matchField(calls[0]), undefined);
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

    const logged: unknown[][] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      stubFetch(404);
      await syncScrimNightMessage(underway().client, NIGHT_ID);
    } finally {
      console.error = realError;
    }
    assert.equal(logged.length, 1, 'logged, and no replacement posted');
  });

  await test('finalizeEndedScrimNights: finalizes ended nights only', async () => {
    withWebhook();
    const { db, client } = fixture(-3 * HOUR, {
      scrim_nights: [idleFor(scrimNightStartingIn(-3 * HOUR, NIGHT_ID), 2 * HOUR), scrimNightStartingIn(-10 * MIN, 6)],
      scrim_night_discord_state: [state({ reminder_message_id: 'a' }), state({ night_id: 6, reminder_message_id: 'b' }), state({ night_id: 7, reminder_message_id: 'c', finalized_at: '2026-01-01T00:00:00Z' })],
    });
    const calls = stubFetch();
    await finalizeEndedScrimNights(client);
    assert.deepEqual(calls.map((c) => c.url), [`${WEBHOOK}/messages/a`]);
    assert.ok(db.scrim_night_discord_state[0].finalized_at);
    assert.equal(db.scrim_night_discord_state[1].finalized_at, null);
  });

  await test('notifyScrimMatchProgress: syncs the night of a scrim match; a league match is a no-op', async () => {
    withWebhook();
    const { client } = underway({ matches: [scrimMatch(900, 1, null), { id: 100, week_id: 1, scrim_night_id: null, match_number: 1, final_score: null }], live_match_score: [liveScore(900, 1, 0, 1)] });
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
    withWebhook();
    const { client } = fixture(5 * HOUR, { scrim_night_discord_state: [state({ announcement_message_id: 'ann', reminder_message_id: 'night' })] });
    const ids = await getScrimNightMessageIds(client, NIGHT_ID);
    assert.deepEqual(ids, ['ann', 'night']);
    const calls = stubFetch(404);
    const logged: unknown[][] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      await deleteScrimNightMessages(NIGHT_ID, ids);
    } finally {
      console.error = realError;
    }
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
    const logged: unknown[][] = [];
    const realError = console.error;
    console.error = (...a: unknown[]) => void logged.push(a);
    try {
      await scheduleScrimNightReminder(refused, NIGHT_ID, '2026-12-01T01:00:00.000Z');
    } finally {
      console.error = realError;
    }
    assert.equal(logged.length, 1);
  });

  report();
}

await main();
