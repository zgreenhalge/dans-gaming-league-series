/**
 * Regression harness for `claimJob()` (src/lib/background-jobs.ts) — the once-per-`(job_type,
 * match_id)` claim every auto-dispatch route races on: the first claim wins, a second reports
 * `'duplicate'`, and a failed claim write reports `{ error }` rather than looking like a lost race.
 *
 * Run:  npx vitest run src/lib/background-jobs.test.ts
 */

import assert from 'node:assert/strict';
import { claimJob } from './background-jobs';
import { BACKGROUND_JOB_TYPES, jobClaimOperation } from './jobs';
import { operationLabel } from '@/components/OpsErrorList';
import { clientFailingOn, createFakeSupabaseClient, type FakeDb } from './test-support/fakeSupabase';
import { test, report } from './test-support/miniTest';

const RECEIVED = { status: 'received', stage: 'received' };

async function main() {
  await test('claimJob — the first claim wins and writes the initial status/stage', async () => {
    const db: FakeDb = { background_jobs: [] };
    const admin = createFakeSupabaseClient(db);
    assert.equal(await claimJob(admin, 'demo_ingest', 5, RECEIVED), 'claimed');
    assert.equal(db.background_jobs.length, 1);
    assert.equal(db.background_jobs[0].job_type, 'demo_ingest');
    assert.equal(db.background_jobs[0].match_id, 5);
    assert.equal(db.background_jobs[0].status, 'received');
    assert.equal(db.background_jobs[0].stage, 'received');
  });

  await test('claimJob — a second claim for the same (job_type, match) returns duplicate and leaves the row alone', async () => {
    const db: FakeDb = { background_jobs: [] };
    const admin = createFakeSupabaseClient(db);
    assert.equal(await claimJob(admin, 'demo_ingest', 5, RECEIVED), 'claimed');
    db.background_jobs[0].status = 'running';
    assert.equal(await claimJob(admin, 'demo_ingest', 5, RECEIVED), 'duplicate');
    assert.equal(db.background_jobs.length, 1);
    assert.equal(db.background_jobs[0].status, 'running');
  });

  await test('claimJob — a different job type or match claims independently', async () => {
    const db: FakeDb = { background_jobs: [] };
    const admin = createFakeSupabaseClient(db);
    assert.equal(await claimJob(admin, 'demo_ingest', 5, RECEIVED), 'claimed');
    assert.equal(await claimJob(admin, 'replay_extract', 5, { status: 'queued', stage: 'validate' }), 'claimed');
    assert.equal(await claimJob(admin, 'demo_ingest', 6, RECEIVED), 'claimed');
    assert.equal(db.background_jobs.length, 3);
  });

  await test('claimJob — a failed claim write reports { error } and writes nothing, no ops error', async () => {
    const db: FakeDb = { background_jobs: [], ops_errors: [] };
    const admin = clientFailingOn(createFakeSupabaseClient(db), 'background_jobs', 'upsert', { code: 'TEST', message: 'boom' });
    assert.deepEqual(await claimJob(admin, 'demo_ingest', 5, RECEIVED), { error: 'boom' });
    assert.equal(db.background_jobs.length, 0);
    assert.equal(db.ops_errors.length, 0);
  });

  await test('operationLabel — every background job type\'s claim operation has a derived label', () => {
    for (const type of BACKGROUND_JOB_TYPES) {
      const operation = jobClaimOperation(type);
      assert.notEqual(operationLabel(operation), operation);
    }
    assert.equal(operationLabel('demo_ingest_claim'), 'Demo Ingest Claim');
    assert.equal(operationLabel('unknown_op'), 'unknown_op');
  });

  report();
}

await main();
