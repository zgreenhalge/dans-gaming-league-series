/**
 * Route-handler tests for POST /api/ingest/matchzy-log's scrim night hook: a `going_live` or
 * `round_end` for a scrim match edits its night's Discord message, an event that carries no score
 * does not, and a league match (whose live score goes on its own match message) leaves the night
 * message alone. A request without the shared secret does nothing.
 *
 * Run:  npx vitest run src/app/api/ingest/matchzy-log/route.test.ts
 */

import assert from 'node:assert/strict';
import { vi } from 'vitest';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { __setTestAfterMode, __flushTestAfter } from '@/lib/after';
import type { FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { scrimNightStartingIn } from '@/lib/test-support/scrimFixtures';
import { clientWithNightMessageRpcs, scrimNightMessageTables, watchNightMessageEdits } from '@/lib/test-support/scrimNightMessageProbe';
import { POST } from './route';

// The last-contact marker is an R2 write, outside what these tests cover.
vi.mock('@/lib/demo/matchzyContact', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/demo/matchzyContact')>()),
  putMatchzyContact: vi.fn(async () => {}),
}));

const SECRET = 'test-secret';
const NIGHT_ID = 5;
const SCRIM_MATCH_ID = 900;
const LEAGUE_MATCH_ID = 100;

function installFixture(): FakeDb {
  process.env.INGEST_REMOTE_LOG_SECRET = SECRET;
  const db: FakeDb = {
    ...scrimNightMessageTables(NIGHT_ID),
    players: [],
    scrim_nights: [scrimNightStartingIn(-10 * 60 * 1000, NIGHT_ID)],
    scrim_signups: [],
    matches: [
      { id: SCRIM_MATCH_ID, week_id: null, scrim_night_id: NIGHT_ID, match_number: 1, final_score: null },
      { id: LEAGUE_MATCH_ID, week_id: 10, scrim_night_id: null, match_number: 1, final_score: null },
    ],
    match_discord_state: [],
  };
  __setTestAdminClient(clientWithNightMessageRpcs(db));
  return db;
}

const send = (body: unknown, token: string | null = SECRET) => {
  const req = jsonRequest('http://localhost/api/ingest/matchzy-log', 'POST', body);
  if (token) req.headers.set('x-matchzy-token', token);
  return POST(req);
};
const roundEnd = (matchid: number) => ({ event: 'round_end', matchid, round_number: 3, team1: { score: 2 }, team2: { score: 1 } });

async function main() {
  __setTestAfterMode(true); // the route defers its side effects with after()

  await test('a going_live and each round_end of a scrim match edit its night message', async () => {
    installFixture();
    const { edits, stop } = watchNightMessageEdits();
    try {
      assert.equal((await send({ event: 'going_live', matchid: SCRIM_MATCH_ID })).status, 200);
      await __flushTestAfter();
      assert.equal(edits.length, 1);
      assert.equal((await send(roundEnd(SCRIM_MATCH_ID))).status, 200);
      await __flushTestAfter();
      assert.equal(edits.length, 2);
    } finally {
      stop();
    }
  });

  await test('an event with no score to show leaves the night message alone', async () => {
    installFixture();
    const { edits, stop } = watchNightMessageEdits();
    try {
      await send({ event: 'series_start', matchid: SCRIM_MATCH_ID });
      await __flushTestAfter();
      assert.equal(edits.length, 0);
    } finally {
      stop();
    }
  });

  await test('a league match\'s going_live and round_end leave the night message alone', async () => {
    installFixture();
    const { edits, stop } = watchNightMessageEdits();
    try {
      await send({ event: 'going_live', matchid: LEAGUE_MATCH_ID });
      await send(roundEnd(LEAGUE_MATCH_ID));
      await __flushTestAfter();
      assert.equal(edits.length, 0);
    } finally {
      stop();
    }
  });

  await test('401 without the shared secret, and nothing is edited', async () => {
    installFixture();
    const { edits, stop } = watchNightMessageEdits();
    try {
      assert.equal((await send({ event: 'going_live', matchid: SCRIM_MATCH_ID }, 'wrong')).status, 401);
      assert.equal((await send({ event: 'going_live', matchid: SCRIM_MATCH_ID }, null)).status, 401);
      await __flushTestAfter();
      assert.equal(edits.length, 0);
    } finally {
      stop();
    }
  });

  report();
}

await main();

__setTestAdminClient(undefined);
