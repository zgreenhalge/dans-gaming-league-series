/**
 * Regression harness for ehog-recompute.ts's background_jobs status tracking (#335) — specifically
 * guards the ordering fix where the 'running' status write must fully settle before the recompute
 * fetch is even invoked. An earlier version ran them concurrently via Promise.all; when the fetch
 * rejected before that write landed, Promise.all moved straight to recording 'failed' without
 * waiting for the still-in-flight 'running' upsert, which could then land afterward and silently
 * overwrite the failure back to a stuck "running" row forever.
 *
 * Run:  npx vitest run src/lib/ehog-recompute.test.ts
 */

import assert from 'node:assert/strict';
import { triggerRatingRecompute } from './ehog-recompute';
import { matchJobKey } from './background-jobs';
import { test, report } from './test-support/miniTest';

function noopDeps() {
  return {
    fetch: (async () => ({ ok: true }) as Response) as typeof fetch,
    recordOpsError: async () => {},
    clearOpsError: async () => {},
    recordJobStatus: async () => ({}),
    advanceJobStatus: async () => ({}),
    resolveStaleFailures: async () => ({}),
  };
}

const ORIGINAL_SECRET = process.env.RECOMPUTE_SECRET;
process.env.RECOMPUTE_SECRET = 'test-secret';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await test('triggerRatingRecompute — the running-status write settles before the fetch is invoked', async () => {
    const calls: string[] = [];
    await triggerRatingRecompute(null as never, {
      jobKey: matchJobKey(100),
      deps: {
        fetch: (async () => {
          calls.push('fetch-invoked');
          return { ok: true } as Response;
        }) as typeof fetch,
        recordOpsError: async () => {},
        clearOpsError: async () => {
          calls.push('ops-error-cleared');
        },
        recordJobStatus: async (_admin, _jobType, _key, fields) => {
          await delay(10);
          assert.equal(fields.status, 'running');
          calls.push('running-write-settled');
          return {};
        },
        advanceJobStatus: async (_admin, _jobType, _key, fields) => {
          assert.equal(fields.status, 'succeeded');
          calls.push('succeeded-write');
          return {};
        },
        resolveStaleFailures: async () => {
          calls.push('stale-failures-closed');
          return {};
        },
      },
    });
    // The first two entries carry the ordering guarantee this file exists to protect (the
    // running-status write settles before the fetch fires) — checked exactly. The post-success
    // writes (ops-error clear, the tracked job's own succeeded write, and sweeping stale failures
    // elsewhere) all run inside one Promise.all, so only their *membership* is asserted, not order.
    assert.deepEqual(calls.slice(0, 2), ['running-write-settled', 'fetch-invoked']);
    assert.deepEqual(
      calls.slice(2).sort(),
      ['ops-error-cleared', 'stale-failures-closed', 'succeeded-write'],
    );
  });

  await test('triggerRatingRecompute — a fetch rejection cannot race an in-flight running-status write', async () => {
    const calls: string[] = [];
    await triggerRatingRecompute(null as never, {
      jobKey: matchJobKey(100),
      deps: {
        fetch: (async () => {
          calls.push('fetch-rejected');
          throw new Error('network down');
        }) as typeof fetch,
        recordOpsError: async () => {
          calls.push('ops-error-recorded');
        },
        clearOpsError: async () => {},
        recordJobStatus: async (_admin, _jobType, _key, fields) => {
          await delay(10);
          assert.equal(fields.status, 'running');
          calls.push('running-write-settled');
          return {};
        },
        advanceJobStatus: async (_admin, _jobType, _key, fields) => {
          assert.equal(fields.status, 'failed');
          calls.push('failed-write');
          return {};
        },
        resolveStaleFailures: async () => {
          calls.push('stale-failures-closed');
          return {};
        },
      },
    });
    // The running write must be the very first thing to complete — nothing downstream (the fetch, or
    // the failed-write it triggers) can start until it has.
    assert.deepEqual(calls, ['running-write-settled', 'fetch-rejected', 'ops-error-recorded', 'failed-write']);
  });

  await test('triggerRatingRecompute — no jobKey skips the per-match job write, but still sweeps stale failures', async () => {
    // The admin "recompute now" control has no single match to key a background_jobs row against, so
    // it never calls recordJobStatus/advanceJobStatus — but its success still means a full history
    // walk just ran, so any other match's stale `failed` ehog_recompute row should still get closed.
    let jobWritesAttempted = 0;
    let sweepCalled = false;
    await triggerRatingRecompute(null as never, {
      deps: {
        ...noopDeps(),
        recordJobStatus: async () => {
          jobWritesAttempted++;
          return {};
        },
        advanceJobStatus: async () => {
          jobWritesAttempted++;
          return {};
        },
        resolveStaleFailures: async (_admin, jobType, excludeKey) => {
          sweepCalled = true;
          assert.equal(jobType, 'ehog_recompute');
          assert.equal(excludeKey, undefined);
          return {};
        },
      },
    });
    assert.equal(jobWritesAttempted, 0);
    assert.equal(sweepCalled, true);
  });

  report();
}

await main().finally(() => {
  process.env.RECOMPUTE_SECRET = ORIGINAL_SECRET;
});
