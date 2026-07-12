/**
 * Regression harness for queries.ts's sabremetrics functions (#63) — getAllSabremetrics,
 * getSabremetricSeasonTotals.
 *
 * Run:  npx tsx src/lib/queries-sabremetrics.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getAllSabremetrics, getSabremetricSeasonTotals } from './queries';

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
  await test('getAllSabremetrics() — one row per (player, played match), snapshot', async () => {
    const rows = await getAllSabremetrics();
    // 12 sabremetrics rows in the fixture (matches 100, 200, 300 — 4 players each).
    assert.equal(rows.length, 12);
    matchesSnapshot('getAllSabremetrics-all', rows);
  });

  await test('getAllSabremetrics(1) — scoped to season 1, only match 100\'s 4 rows', async () => {
    const rows = await getAllSabremetrics(1);
    assert.equal(rows.length, 4);
    matchesSnapshot('getAllSabremetrics-season1', rows);
  });

  await test('getSabremetricSeasonTotals() — one row per (player, season), snapshot', async () => {
    const rows = await getSabremetricSeasonTotals();
    // Season 1: players 1-4 (match 100). Season 2: players 1,2,5,6 (match 200).
    // Season 4: players 3,4,7,8 (match 300). 12 (player, season) pairs, matching the per-match count
    // 1:1 here since no player appears twice in the same season in this fixture.
    assert.equal(rows.length, 12);
    matchesSnapshot('getSabremetricSeasonTotals', rows);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('\nFailures:\n');
    for (const f of failures) console.error(`✗ ${f}\n`);
    process.exit(1);
  }
}

main();
