/**
 * Regression harness for queries.ts's trophies/medals function (#63) — getAllSeasonMedalists.
 * The fixture's regular season (id 1) is COMPLETED, not ARCHIVED, so it deliberately exercises the
 * "not archived, skip" branch for regular-season trophies — only the gauntlet trophy path (which
 * doesn't check season status) can produce entries against this fixture.
 *
 * Run:  npx tsx src/lib/queries-trophies.test.ts
 */

import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getAllSeasonMedalists } from './queries';

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
  await test('getAllSeasonMedalists() — snapshot', async () => {
    matchesSnapshot('getAllSeasonMedalists', await getAllSeasonMedalists());
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('\nFailures:\n');
    for (const f of failures) console.error(`✗ ${f}\n`);
    process.exit(1);
  }
}

main();
