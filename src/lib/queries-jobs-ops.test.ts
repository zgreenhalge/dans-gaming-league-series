/**
 * Regression harness for queries.ts's admin jobs/ops functions (#63) — getBackgroundJobs,
 * getOpsErrors. getOpsErrors exercises the fake client's embedded-select resolution again (a
 * second, independent call site from getAdminMatches/getOtherScheduledMatches).
 *
 * Run:  npx tsx src/lib/queries-jobs-ops.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getBackgroundJobs, getOpsErrors } from './queries';
import { test, report } from './test-support/miniTest';

async function main() {
  await test('getBackgroundJobs() — all 5 fixture jobs, newest-updated first, snapshot', async () => {
    const jobs = await getBackgroundJobs();
    assert.equal(jobs.length, 5);
    matchesSnapshot('getBackgroundJobs', jobs);
  });

  await test('getOpsErrors() — all 3 entity types resolve a label, newest first, snapshot', async () => {
    const errors = await getOpsErrors();
    assert.equal(errors.length, 3);
    const byType = new Map(errors.map((e) => [e.entityType, e.label]));
    assert.equal(byType.get('season'), 'Season 5');
    assert.equal(byType.get('system'), 'EHOG Recompute');
    matchesSnapshot('getOpsErrors', errors);
  });

  report();
}

main();
