/**
 * Regression harness for queries.ts's match-detail functions (#63) — getMatch,
 * getMatchSabremetrics, getMatchScoutingData.
 *
 * Run:  npx tsx src/lib/queries-match-detail.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getMatch, getMatchSabremetrics, getMatchScoutingData } from './queries';

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
  await test('getMatch(100) — played match with full roster, snapshot', async () => {
    matchesSnapshot('getMatch-100', await getMatch(100));
  });

  await test('getMatch(101) — unplayed pre-veto match, snapshot', async () => {
    matchesSnapshot('getMatch-101', await getMatch(101));
  });

  await test('getMatch(9999) — nonexistent id returns null', async () => {
    assert.equal(await getMatch(9999), null);
  });

  await test('getMatchSabremetrics(100) — played match, snapshot', async () => {
    const rows = await getMatchSabremetrics(100);
    assert.equal(rows.length, 4);
    matchesSnapshot('getMatchSabremetrics-100', rows);
  });

  await test('getMatchSabremetrics(101) — unplayed match has no sabremetrics rows', async () => {
    assert.deepEqual(await getMatchSabremetrics(101), []);
  });

  await test('getMatchScoutingData(100) — full scouting report, snapshot', async () => {
    const data = await getMatchScoutingData(100);
    assert.notEqual(data, null);
    matchesSnapshot('getMatchScoutingData-100', data);
  });

  await test('getMatchScoutingData(101) — pre-staged roster (zero stats), snapshot', async () => {
    matchesSnapshot('getMatchScoutingData-101', await getMatchScoutingData(101));
  });

  await test('getMatchScoutingData(9999) — no roster returns null', async () => {
    assert.equal(await getMatchScoutingData(9999), null);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('\nFailures:\n');
    for (const f of failures) console.error(`✗ ${f}\n`);
    process.exit(1);
  }
}

main();
