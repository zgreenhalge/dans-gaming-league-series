/**
 * Route-handler harness for GET /api/matches/[id]/demo/result — its database reads: a job row, no
 * job row, and a failed job-status or match read (500, not "no job yet"). R2 is stubbed with no
 * staged artifact and no demo, so each case exercises only the database reads.
 *
 * Run:  npx vitest run 'src/app/api/matches/[id]/demo/result/route.test.ts'
 */

import assert from 'node:assert/strict';
import { vi } from 'vitest';

vi.mock('@/lib/r2', () => ({
  getR2Object: async () => null,
  headDemoObject: async () => null,
  deleteR2Object: async () => {},
  demoResultKey: (id: number) => `${id}/result.json.gz`,
  mapResultKey: (id: number) => `${id}/map_result.json`,
}));

import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { clientFailingOn, createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { DEMO_INGEST_JOB_TYPE } from '@/lib/demo/ingestResult';
import { GET } from './route';

const ADMIN_ID = 1;
const MATCH_ID = 42;

// A scrim match with its map set and no score: ready to play, so a GET with no job row goes on to
// read the match for the orphaned-demo check.
function fixtureDb(): FakeDb {
  return {
    players: [{ id: ADMIN_ID, is_admin: true }],
    player_match_stats: [],
    scrim_nights: [{ id: 1 }],
    matches: [{ id: MATCH_ID, final_score: null, scrim_night_id: 1, week_id: null, shirts_pick: 'de_cache' }],
    background_jobs: [],
  };
}

async function assertFailedRead(table: string) {
  __setTestAdminClient(
    clientFailingOn(createFakeSupabaseClient(fixtureDb()), table, 'select', { code: 'TEST', message: 'connection reset' }),
  );
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  const res = await call();
  errorLog.mockRestore();
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error?: string };
  assert.ok(body.error);
  assert.ok(!body.error.includes('connection reset'));
}

function call() {
  __setTestSession(sessionFor(ADMIN_ID));
  return GET(jsonRequest(`http://localhost/api/matches/${MATCH_ID}/demo/result`, 'GET'), {
    params: Promise.resolve({ id: String(MATCH_ID) }),
  });
}

async function main() {
  await test('GET — a job row is reported with its status', async () => {
    const db = fixtureDb();
    db.background_jobs.push({ job_type: DEMO_INGEST_JOB_TYPE, match_id: MATCH_ID, status: 'parsed', updated_at: null });
    __setTestAdminClient(createFakeSupabaseClient(db));
    const res = await call();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'parsed', stale: false, result: null, hasDemo: false });
  });

  await test('GET — no job row reads as status null (200)', async () => {
    __setTestAdminClient(createFakeSupabaseClient(fixtureDb()));
    const res = await call();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: null, stale: false, result: null, hasDemo: false });
  });

  await test('GET — a failed job-status read answers 500 without the error detail', () => assertFailedRead('background_jobs'));

  await test('GET — a failed match read answers 500 without the error detail', () => assertFailedRead('matches'));

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
