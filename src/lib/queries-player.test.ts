/**
 * Regression harness for queries.ts's player-core functions (#63) — getPlayer, getPlayersById.
 * (fetchAllPages()'s real >1000-row pagination boundary is exercised in queries-maps.test.ts via
 * getAllPlayedMatchIds()/getMatchIdsForMap(), which share the same helper — the fixture's
 * pagination filler lives on the `matches` table, not `player_match_stats`.)
 *
 * Run:  npx tsx src/lib/queries-player.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getPlayer, getPlayersById } from './queries';

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
  await test('getPlayersById() — returns a Map keyed by id, one row per fixture player', async () => {
    const players = await getPlayersById();
    assert.equal(players.size, 8);
    assert.equal(players.get(1)?.name, 'Alice');
    matchesSnapshot('getPlayersById', players);
  });

  await test('getPlayer(1) — full history across 4 matches, real rounds/S3 exclusion, snapshot', async () => {
    const detail = await getPlayer(1);
    assert.notEqual(detail, null);
    // Alice appears in matches 100, 102 (zero-stat), 200, 400 (zero-stat) = 4 stat rows total,
    // all of which resolve since they all have a matching `matches` fixture row.
    assert.equal(detail!.history.length, 4);
    matchesSnapshot('getPlayer-1', detail);
  });

  await test('getPlayer(7) — Grace, played only one match, snapshot', async () => {
    matchesSnapshot('getPlayer-7', await getPlayer(7));
  });

  await test('getPlayer(9999) — nonexistent player returns null', async () => {
    assert.equal(await getPlayer(9999), null);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('\nFailures:\n');
    for (const f of failures) console.error(`✗ ${f}\n`);
    process.exit(1);
  }
}

main();
