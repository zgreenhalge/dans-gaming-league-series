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

import { notifyMatchServerLive, notifyMatchScoreReported, notifyMatchLiveScore } from './discord-notify';
import type { LiveScoreRow } from './demo/liveScore';
import { test, report } from './test-support/miniTest';

interface FetchCall {
  url: string;
  method: string;
  body: {
    content: string;
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

function liveScore(matchId: number, shirts: number, skins: number, round: number | null): LiveScoreRow {
  return { matchId, shirts, skins, round, updatedAt: new Date().toISOString() };
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
    assert.equal(
      embed.description,
      'on Foroglio\n\n🟢 **Server is live**',
      'map line comes first, then the status block — no roster here, since it lives in content',
    );
    assert.doesNotMatch(embed.description, /\/matches\//, 'no link line — the title is already the link');
    assert.equal(embed.url, `https://dans-gaming-league-series.vercel.app/matches/100`, 'the title carries the link via embed.url');
    assert.match(embed.thumbnail?.url ?? '', /\/maps\/foroglio\.jpg$/);
    assert.equal(embed.fields, undefined, 'no stats exist yet when the server goes live');
    assert.equal(
      calls[0].body.content,
      '**Alice** & **Bob** vs **Carol** & **Dave**',
      'the roster line lives in content, not the embed, since only content renders mentions as tags',
    );
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
    assert.equal(
      embed.description,
      'on Foroglio\n\n🏁 **Match complete**\n**Final: 13-9**',
      'no roster line — the box score below already names every player, and the roster tag line lives in content anyway',
    );
    assert.doesNotMatch(embed.description, /\/matches\//, 'no link line — the title is already the link');

    assert.equal(embed.fields?.length, 2);
    const shirts = embed.fields?.find((f) => f.name === 'Shirts');
    const skins = embed.fields?.find((f) => f.name === 'Skins');
    assert.ok(!shirts?.inline && !skins?.inline, 'box score fields stack full-width, not side by side');
    assert.match(shirts!.value, /^```\nPlayer\s+K\/A\/D\s+ADR\n/, 'a fixed-width table inside a code block — plain names, not tags: mentions/markdown don\'t render inside one anyway');
    assert.match(shirts!.value, /Alice\s+20\/3\/15\s+85\.5/);
    assert.match(shirts!.value, /Bob\s+18\/5\/16\s+78\.18/);
    assert.match(shirts!.value, /```$/);
    assert.match(skins!.value, /Carol\s+14\/4\/19\s+65\b/);
    assert.match(skins!.value, /Dave\s+12\/6\/20\s+60\.09/);

    assert.equal(discordState(100)?.notification_message_id, 'stub-msg-1');
  });

  await test('notifyMatchScoreReported: tags a player with a linked name-color role in the content roster line, but never in the box score table', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    resetDiscordState(100);
    const alice = fakeDb.players.find((p) => p.id === 1)!;
    alice.discord_name_role_id = '123456789012345678';
    try {
      const { calls } = stubFetch();
      await notifyMatchScoreReported(adminClient, 100);
      assert.equal(
        calls[0].body.content,
        '<@&123456789012345678> & **Bob** vs **Carol** & **Dave**',
        'a linked player is a role mention in content; an unlinked one still falls back to their bolded name',
      );
      const shirts = calls[0].body.embeds[0].fields?.find((f) => f.name === 'Shirts');
      assert.match(shirts!.value, /Alice\s+20\/3\/15\s+85\.5/, 'the box score never tags — even a linked player shows their plain name there');
      assert.doesNotMatch(shirts!.value, /<@&/, 'no role mention syntax inside the code block — it would render as literal text');
    } finally {
      alice.discord_name_role_id = null;
    }
  });

  await test('notifyMatchLiveScore: no-ops without DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL', async () => {
    delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
    const { calls } = stubFetch();
    await notifyMatchLiveScore(adminClient, 100, 'round_end', liveScore(100, 7, 5, 13));
    assert.equal(calls.length, 0);
  });

  await test('notifyMatchLiveScore: ignores an event it wasn\'t called for, e.g. map_result', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    resetDiscordState(100);
    stubFetch();
    await notifyMatchServerLive(adminClient, 100);

    const { calls } = stubFetch();
    await notifyMatchLiveScore(adminClient, 100, 'map_result', liveScore(100, 13, 9, null));
    assert.equal(calls.length, 0, 'map_result\'s score is superseded by notifyMatchScoreReported() moments later, so editing here would just flicker');
  });

  await test('notifyMatchLiveScore: no-ops for a null live score row', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    resetDiscordState(100);
    stubFetch();
    await notifyMatchServerLive(adminClient, 100);

    const { calls } = stubFetch();
    await notifyMatchLiveScore(adminClient, 100, 'round_end', null);
    assert.equal(calls.length, 0);
  });

  await test('notifyMatchLiveScore: no-ops (never posts a fresh message) when nothing is on record yet', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    resetDiscordState(100);
    const { calls } = stubFetch();
    await notifyMatchLiveScore(adminClient, 100, 'round_end', liveScore(100, 7, 5, 13));
    assert.equal(calls.length, 0);
  });

  await test('notifyMatchLiveScore: edits the server-live message with the running score', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    // Match 101 (unlike 100) has no final_score yet — a genuinely in-progress match, which
    // notifyMatchLiveScore()'s "already scored" guard requires.
    resetDiscordState(101);
    stubFetch();
    await notifyMatchServerLive(adminClient, 101);
    const liveMessageId = discordState(101)?.notification_message_id;
    assert.ok(liveMessageId, 'precondition: server-live left a message id on record');

    const { calls } = stubFetch();
    await notifyMatchLiveScore(adminClient, 101, 'round_end', liveScore(101, 7, 5, 13));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(calls[0].url, `https://discord.example/webhook/messages/${liveMessageId}`);
    const embed = calls[0].body.embeds[0];
    assert.equal(embed.title, 'Week 1 · Match 2', 'title stays Week/Match through a live tick');
    assert.match(embed.description, /LIVE\*\*\n\*\*7-5.*Round 13/);
    assert.equal(embed.fields, undefined, 'no box score mid-match — player stats land only once the match is scored');
    assert.equal(discordState(101)?.notification_message_id, liveMessageId, 'still the same source-of-truth message');
  });

  await test('notifyMatchLiveScore: a going_live tick with no round number omits "Round"', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    resetDiscordState(101);
    stubFetch();
    await notifyMatchServerLive(adminClient, 101);

    const { calls } = stubFetch();
    await notifyMatchLiveScore(adminClient, 101, 'going_live', liveScore(101, 0, 0, null));
    const embed = calls[0].body.embeds[0];
    assert.match(embed.description, /LIVE\*\*\n\*\*0-0\*\*/);
    assert.doesNotMatch(embed.description, /Round/);
  });

  await test('notifyMatchLiveScore: no-ops (doesn\'t regress the message) once the match already has a final score', async () => {
    process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = 'https://discord.example/webhook';
    resetDiscordState(100);
    stubFetch();
    await notifyMatchScoreReported(adminClient, 100);
    const finalMessageId = discordState(100)?.notification_message_id;
    assert.ok(finalMessageId, 'precondition: the match already has a final score and a posted message');

    const { calls } = stubFetch();
    // A delayed/retried round_end arriving after the score was already reported and confirmed.
    await notifyMatchLiveScore(adminClient, 100, 'round_end', liveScore(100, 13, 9, 22));
    assert.equal(calls.length, 0, 'must not overwrite the final box-score message with a stale LIVE state');
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
