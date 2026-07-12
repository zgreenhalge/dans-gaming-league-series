/**
 * Regression harness for queries.ts's schedule functions (#63) — getSeasonSchedule,
 * getOtherScheduledMatches.
 *
 * Run:  npx tsx src/lib/queries-schedule.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getSeasonSchedule, getOtherScheduledMatches } from './queries';

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
  await test('getSeasonSchedule(1) — regular season with a bye week, snapshot', async () => {
    const schedule = await getSeasonSchedule(1);
    assert.equal(schedule.length, 2);
    matchesSnapshot('getSeasonSchedule-1', schedule);
  });

  await test('getSeasonSchedule(3) — active season, only an unplayed match, snapshot', async () => {
    matchesSnapshot('getSeasonSchedule-3', await getSeasonSchedule(3));
  });

  await test('getSeasonSchedule(9999) — no weeks returns []', async () => {
    assert.deepEqual(await getSeasonSchedule(9999), []);
  });

  await test('getOtherScheduledMatches(999) — excludes played matches, only unplayed+scheduled, snapshot', async () => {
    const others = await getOtherScheduledMatches(999);
    // Only match 101 is unplayed AND scheduled in the fixture.
    assert.equal(others.length, 1);
    assert.equal(others[0].id, 101);
    matchesSnapshot('getOtherScheduledMatches-999', others);
  });

  await test('getOtherScheduledMatches(101) — excludes itself via .neq()', async () => {
    const others = await getOtherScheduledMatches(101);
    assert.equal(others.some((m) => m.id === 101), false);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('\nFailures:\n');
    for (const f of failures) console.error(`✗ ${f}\n`);
    process.exit(1);
  }
}

main();
