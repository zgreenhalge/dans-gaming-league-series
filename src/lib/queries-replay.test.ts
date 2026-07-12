/**
 * Regression harness for queries.ts's replay-status function (#63) — getReplayJobState.
 * (getAllPlayedMatchIds is covered in queries-maps.test.ts since it shares the map-domain
 * pagination test; getReplayEventsView reads R2 directly, no Supabase involved, out of scope.)
 *
 * Run:  npx tsx src/lib/queries-replay.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getReplayJobState } from './queries';

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      passed++;
    } catch (err) {
      failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
    }
  })();
}

async function main() {
  await test('getReplayJobState(100) — ready status, no background_jobs replay_extract row surfaces stage, snapshot', async () => {
    matchesSnapshot('getReplayJobState-100', await getReplayJobState(100));
  });

  await test('getReplayJobState(200) — ready status but a failed replay_extract job, snapshot', async () => {
    matchesSnapshot('getReplayJobState-200', await getReplayJobState(200));
  });

  await test('getReplayJobState(101) — no replay_status column value defaults to "none"', async () => {
    const state = await getReplayJobState(101);
    assert.equal(state.status, 'none');
  });

  await test('getReplayJobState(9999) — nonexistent match returns the "none" default, not a throw', async () => {
    const state = await getReplayJobState(9999);
    assert.equal(state.status, 'none');
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('\nFailures:\n');
    for (const f of failures) console.error(`✗ ${f}\n`);
    process.exit(1);
  }
}

main();
