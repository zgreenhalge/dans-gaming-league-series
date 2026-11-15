/**
 * Regression harness for `claimJob()` (src/lib/background-jobs.ts) — the once-per-`(job_type,
 * match_id)` claim every auto-dispatch route races on: the first claim wins, a second returns
 * `false`, and a failed claim write surfaces as an ops error rather than a silent no-op.
 *
 * Run:  npx vitest run src/lib/background-jobs.test.ts
 */

import assert from 'node:assert/strict';
import { claimJob } from './background-jobs';
import { clientFailingOn, createFakeSupabaseClient, type FakeDb } from './test-support/fakeSupabase';
import { test, report } from './test-support/miniTest';

const RECEIVED = { status: 'received', stage: 'received' };

async function main() {
  await test('claimJob — the first claim wins and writes the initial status/stage', async () => {
    const db: FakeDb = { background_jobs: [] };
    const admin = createFakeSupabaseClient(db);
    assert.equal(await claimJob(admin, 'demo_ingest', 5, RECEIVED), true);
    assert.equal(db.background_jobs.length, 1);
    assert.equal(db.background_jobs[0].job_type, 'demo_ingest');
    assert.equal(db.background_jobs[0].match_id, 5);
    assert.equal(db.background_jobs[0].status, 'received');
    assert.equal(db.background_jobs[0].stage, 'received');
  });

  await test('claimJob — a second claim for the same (job_type, match) returns false and leaves the row alone', async () => {
    const db: FakeDb = { background_jobs: [] };
    const admin = createFakeSupabaseClient(db);
    assert.equal(await claimJob(admin, 'demo_ingest', 5, RECEIVED), true);
    db.background_jobs[0].status = 'running';
    assert.equal(await claimJob(admin, 'demo_ingest', 5, RECEIVED), false);
    assert.equal(db.background_jobs.length, 1);
    assert.equal(db.background_jobs[0].status, 'running');
  });

  await test('claimJob — a different job type or match claims independently', async () => {
    const db: FakeDb = { background_jobs: [] };
    const admin = createFakeSupabaseClient(db);
    assert.equal(await claimJob(admin, 'demo_ingest', 5, RECEIVED), true);
    assert.equal(await claimJob(admin, 'replay_extract', 5, { status: 'queued', stage: 'validate' }), true);
    assert.equal(await claimJob(admin, 'demo_ingest', 6, RECEIVED), true);
    assert.equal(db.background_jobs.length, 3);
  });

  await test('claimJob — a failed claim write returns false and records a <jobType>_claim ops error', async () => {
    const db: FakeDb = { background_jobs: [], ops_errors: [] };
    const admin = clientFailingOn(createFakeSupabaseClient(db), 'background_jobs', 'upsert', { code: 'TEST', message: 'boom' });
    assert.equal(await claimJob(admin, 'demo_ingest', 5, RECEIVED), false);
    assert.equal(db.background_jobs.length, 0);
    assert.equal(db.ops_errors.length, 1);
    assert.equal(db.ops_errors[0].entity_type, 'match');
    assert.equal(db.ops_errors[0].entity_id, 5);
    assert.equal(db.ops_errors[0].operation, 'demo_ingest_claim');
    assert.match(String(db.ops_errors[0].message), /boom/);
  });

  report();
}

await main();
