/**
 * Regression harness for queries.ts's trophies/medals function (#63) — getAllSeasonMedalists.
 * The fixture's regular season (id 1) is ARCHIVED, so it exercises the regular-season trophy path
 * alongside the gauntlet trophy path — the fixture's other regular season (id 3, "Season 6") is
 * ACTIVE and deliberately exercises the "not archived, skip" branch.
 *
 * Run:  npx vitest run src/lib/queries-trophies.test.ts
 */

import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getAllSeasonMedalists } from './queries';
import { test, report } from './test-support/miniTest';

async function main() {
  await test('getAllSeasonMedalists() — snapshot', async () => {
    matchesSnapshot('getAllSeasonMedalists', await getAllSeasonMedalists());
  });

  report();
}

await main();
