/**
 * Regression harness for ehog-recompute.ts's background_jobs status tracking (#335) — specifically
 * guards the ordering fix where the 'running' status write must fully settle before the recompute
 * fetch is even invoked. An earlier version ran them concurrently via Promise.all; when the fetch
 * rejected before that write landed, Promise.all moved straight to recording 'failed' without
 * waiting for the still-in-flight 'running' upsert, which could then land afterward and silently
 * overwrite the failure back to a stuck "running" row forever.
 *
 * Run:  npx tsx src/lib/ehog-recompute.test.ts
 */

import assert from 'node:assert/strict';
import { triggerRatingRecompute } from './ehog-recompute';
import { matchJobKey } from './background-jobs';
import { test, report } from './test-support/miniTest';

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
      },
    });
    assert.deepEqual(calls, ['running-write-settled', 'fetch-invoked', 'ops-error-cleared', 'succeeded-write']);
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
      },
    });
    // The running write must be the very first thing to complete — nothing downstream (the fetch, or
    // the failed-write it triggers) can start until it has.
    assert.deepEqual(calls, ['running-write-settled', 'fetch-rejected', 'ops-error-recorded', 'failed-write']);
  });

  await test('triggerRatingRecompute — no jobKey means background_jobs is never touched', async () => {
    let jobWritesAttempted = 0;
    await triggerRatingRecompute(null as never, {
      deps: {
        fetch: (async () => ({ ok: true }) as Response) as typeof fetch,
        recordOpsError: async () => {},
        clearOpsError: async () => {},
        recordJobStatus: async () => {
          jobWritesAttempted++;
          return {};
        },
        advanceJobStatus: async () => {
          jobWritesAttempted++;
          return {};
        },
      },
    });
    assert.equal(jobWritesAttempted, 0);
  });

  report();
}

main().finally(() => {
  process.env.RECOMPUTE_SECRET = ORIGINAL_SECRET;
});
