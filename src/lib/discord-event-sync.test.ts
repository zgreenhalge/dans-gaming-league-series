/**
 * Unit tests for discord-event-sync.ts: `syncSeasonScheduledEvents()`'s title-based correlation
 * between Discord guild scheduled events and a season's unplayed matches (#398) — writing a matched
 * event's start time into `matches.scheduled_at`, idempotency once already in sync, `no_event` for a
 * match nothing has been scheduled for yet, and the ops_errors trail for a real listing failure.
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

function stubEvents(events: unknown[] | { status: number; body?: unknown }): { calls: string[] } {
  const calls: string[] = [];
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string) => {
    calls.push(url);
    if (Array.isArray(events)) {
      return { ok: true, status: 200, json: async () => events } as unknown as Response;
    }
    const ok = events.status >= 200 && events.status < 300;
    return { ok, status: events.status, json: async () => events.body ?? { message: 'Missing Access' } } as unknown as Response;
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
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const result = await syncSeasonScheduledEvents(adminClient, 2);
    assert.ok('error' in result);
    assert.match((result as { error: string }).error, /Gauntlet/);
  });

  await test('syncSeasonScheduledEvents: errors for a nonexistent season', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const result = await syncSeasonScheduledEvents(adminClient, 9999);
    assert.deepEqual(result, { error: 'Season not found' });
  });

  await test('syncSeasonScheduledEvents: writes a matched event\'s start time and reports "synced"', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    // Season 1 ("Season 5"): match 100 (week 1) is played (13-9), excluded. Match 101 (week 1) is
    // unplayed with an existing scheduled_at — "Week 1 Game 2". Match 102 (week 2) is unplayed
    // ("0-0") with no scheduled_at yet — "Week 2 Game 1".
    stubEvents([
      { id: 'evt-1', name: 'Week 1 Game 2', scheduled_start_time: '2026-01-20T20:00:00.000Z', status: 1 },
    ]);
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    assert.equal(ok.seasonName, 'Season 5');
    assert.equal(ok.matches.length, 2);

    const m101 = ok.matches.find((m) => m.matchId === 101)!;
    assert.equal(m101.status, 'synced');
    assert.equal(m101.title, 'Week 1 Game 2');
    const m102 = ok.matches.find((m) => m.matchId === 102)!;
    assert.equal(m102.status, 'no_event');

    const { data } = await adminClient.from('matches').select('scheduled_at').eq('id', 101).maybeSingle();
    assert.equal((data as { scheduled_at: string }).scheduled_at, '2026-01-20T20:00:00.000Z');
  });

  await test('syncSeasonScheduledEvents: a re-sync against the same event reports "unchanged" and writes nothing', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    // Match 101's scheduled_at is now '2026-01-20T20:00:00.000Z' from the previous test.
    stubEvents([
      { id: 'evt-1', name: 'Week 1 Game 2', scheduled_start_time: '2026-01-20T20:00:00.000Z', status: 1 },
    ]);
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    const m101 = ok.matches.find((m) => m.matchId === 101)!;
    assert.equal(m101.status, 'unchanged');
  });

  await test('syncSeasonScheduledEvents: ignores a CANCELED event with the same title', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    stubEvents([
      { id: 'evt-2', name: 'Week 2 Game 1', scheduled_start_time: '2026-02-01T18:00:00.000Z', status: 4 },
    ]);
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    const ok = result as Exclude<typeof result, { error: string }>;
    const m102 = ok.matches.find((m) => m.matchId === 102)!;
    assert.equal(m102.status, 'no_event');
  });

  await test('syncSeasonScheduledEvents: a season with no unplayed matches returns an empty result without calling Discord', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    const { calls } = stubEvents([]);
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

  await test('syncSeasonScheduledEvents: a Discord API failure listing events is recorded to ops_errors (entity season) and returned directly', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    stubEvents({ status: 403, body: { message: 'Missing Access' } });
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok('error' in result);
    assert.match((result as { error: string }).error, /403/);
    assert.match((result as { error: string }).error, /Missing Access/);
    const rows = liveOpsErrors('season', 1, 'discord_event_sync');
    assert.equal(rows.length, 1);
  });

  await test('syncSeasonScheduledEvents: a later success clears the prior ops_errors row', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-1';
    assert.equal(liveOpsErrors('season', 1, 'discord_event_sync').length, 1, 'precondition: the previous test left a live error');
    stubEvents([]);
    const result = await syncSeasonScheduledEvents(adminClient, 1);
    assert.ok(!('error' in result));
    assert.equal(liveOpsErrors('season', 1, 'discord_event_sync').length, 0);
  });

  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_GUILD_ID;
  report();
}

await main();
