/**
 * Regression harness for queries.ts's admin jobs/ops functions (#63) — getBackgroundJobs,
 * getOpsErrors. getOpsErrors exercises the fake client's embedded-select resolution again (a
 * second, independent call site from getAdminMatches/getOtherScheduledMatches).
 *
 * Run:  npx vitest run src/lib/queries-jobs-ops.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestAdminClient } from './supabase-admin';
import { clientFailingOn, createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

const fakeClient = createFakeSupabaseClient(buildFakeDb());
__setTestAdminClient(fakeClient);

import { getBackgroundJobs, getOpsErrors } from './queries';
import { test, report } from './test-support/miniTest';

async function main() {
  await test('getBackgroundJobs() — all 5 fixture jobs, newest-updated first, snapshot', async () => {
    const jobs = await getBackgroundJobs();
    assert.equal(jobs.length, 5);
    matchesSnapshot('getBackgroundJobs', jobs);
  });

  await test('getBackgroundJobs() — a failed read rejects instead of returning an empty list', async () => {
    __setTestAdminClient(clientFailingOn(fakeClient, 'background_jobs', 'select', { code: 'TEST', message: 'connection reset' }));
    try {
      await assert.rejects(() => getBackgroundJobs(), { message: 'connection reset' });
    } finally {
      __setTestAdminClient(fakeClient);
    }
  });

  await test('getBackgroundJobs() — a failed maps lookup rejects instead of degrading labels', async () => {
    __setTestAdminClient(clientFailingOn(fakeClient, 'maps', 'select', { code: 'TEST', message: 'maps unreadable' }));
    try {
      await assert.rejects(() => getBackgroundJobs(), { message: 'maps unreadable' });
    } finally {
      __setTestAdminClient(fakeClient);
    }
  });

  await test('getOpsErrors() — all 3 entity types resolve a label, newest first, snapshot', async () => {
    const errors = await getOpsErrors();
    assert.equal(errors.length, 3);
    const byType = new Map(errors.map((e) => [e.entityType, e.label]));
    assert.equal(byType.get('season'), 'Season 5');
    assert.equal(byType.get('system'), 'EHOG Recompute');
    matchesSnapshot('getOpsErrors', errors);
  });

  await test('getOpsErrors() — a scrim night row is labeled by its id and start date, or by id once the night is gone', async () => {
    const db = buildFakeDb();
    db.scrim_nights = [{ id: 7, starts_at: '2026-01-20T01:00:00Z' }];
    db.ops_errors.push(
      { id: 901, entity_type: 'scrim_night', entity_id: 7, operation: 'scrim_announce', message: 'x', occurred_at: '2026-01-21T00:00:00Z', dismissed_at: null },
      { id: 902, entity_type: 'scrim_night', entity_id: 8, operation: 'scrim_announce', message: 'y', occurred_at: '2026-01-21T00:00:00Z', dismissed_at: null },
    );
    __setTestAdminClient(createFakeSupabaseClient(db));
    try {
      const labels = new Map((await getOpsErrors()).filter((e) => e.entityType === 'scrim_night').map((e) => [e.entityId, e.label]));
      assert.equal(labels.get(7), 'Scrim night #7 · 2026-01-20');
      assert.equal(labels.get(8), 'Scrim night #8');
    } finally {
      __setTestAdminClient(fakeClient);
    }
  });

  report();
}

await main();
