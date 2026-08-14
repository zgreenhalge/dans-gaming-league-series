/**
 * Unit tests for `persistSabremetrics()`/`clearSabremetrics()` — the shared
 * `player_match_sabremetrics` persistence used by both the score-confirm route and the demo-ingest
 * reparse path. Exercises the `player_id -> player_match_stats.id` resolution (`_shared.ts`) and the
 * "unresolvable player is dropped, not written" guard, against `fakeSupabase.ts` via
 * `__setTestAdminClient` (these call `getAdminClient()` directly rather than taking a client param).
 *
 * Run:  npx vitest run src/lib/demo/sabremetrics.test.ts
 */

import assert from 'node:assert/strict';
import { persistSabremetrics, clearSabremetrics } from './sabremetrics';
import { __setTestAdminClient } from '../supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '../test-support/fakeSupabase';
import { zeroSabFields as zeroSab } from '../test-support/sabFields';
import type { DemoSabremetricStat } from '../types';
import { test, report } from '../test-support/miniTest';

const MATCH_ID = 100;

function baseDb(): FakeDb {
  return {
    player_match_stats: [
      { id: 1000, match_id: MATCH_ID, player_id: 1 },
      { id: 1001, match_id: MATCH_ID, player_id: 2 },
    ],
    player_match_sabremetrics: [],
  };
}

async function main() {
  await test('persistSabremetrics: upserts a row keyed to each resolved player_match_stats.id', async () => {
    const db = baseDb();
    __setTestAdminClient(createFakeSupabaseClient(db));
    const rows: DemoSabremetricStat[] = [
      { player_id: 1, sabremetrics: zeroSab({ kills_ct: 10, headshot_kills: 3 }) },
      { player_id: 2, sabremetrics: zeroSab({ kills_ct: 5 }) },
    ];
    await persistSabremetrics(MATCH_ID, rows);
    assert.equal(db.player_match_sabremetrics!.length, 2);
    const p1 = db.player_match_sabremetrics!.find((r) => r.player_match_stats_id === 1000)!;
    assert.equal(p1.kills_ct, 10);
    assert.equal(p1.headshot_kills, 3);
  });

  await test('persistSabremetrics: a player with no player_match_stats row for this match is dropped, not written', async () => {
    const db = baseDb();
    __setTestAdminClient(createFakeSupabaseClient(db));
    const rows: DemoSabremetricStat[] = [
      { player_id: 1, sabremetrics: zeroSab() },
      { player_id: 999, sabremetrics: zeroSab({ kills_ct: 99 }) }, // not rostered on this match
    ];
    await persistSabremetrics(MATCH_ID, rows);
    assert.equal(db.player_match_sabremetrics!.length, 1);
    assert.equal(db.player_match_sabremetrics![0].player_match_stats_id, 1000);
  });

  await test('persistSabremetrics: re-persisting for the same player upserts in place, not duplicates', async () => {
    const db = baseDb();
    __setTestAdminClient(createFakeSupabaseClient(db));
    await persistSabremetrics(MATCH_ID, [{ player_id: 1, sabremetrics: zeroSab({ kills_ct: 1 }) }]);
    await persistSabremetrics(MATCH_ID, [{ player_id: 1, sabremetrics: zeroSab({ kills_ct: 9 }) }]);
    assert.equal(db.player_match_sabremetrics!.length, 1);
    assert.equal(db.player_match_sabremetrics![0].kills_ct, 9);
  });

  await test('persistSabremetrics: an empty input is a no-op', async () => {
    const db = baseDb();
    __setTestAdminClient(createFakeSupabaseClient(db));
    await persistSabremetrics(MATCH_ID, []);
    assert.equal(db.player_match_sabremetrics!.length, 0);
  });

  await test('clearSabremetrics: deletes every row for this match\'s resolved players', async () => {
    const db = baseDb();
    db.player_match_sabremetrics = [
      { player_match_stats_id: 1000, ...zeroSab() },
      { player_match_stats_id: 1001, ...zeroSab() },
      { player_match_stats_id: 2000, ...zeroSab() }, // a different match — must survive
    ];
    __setTestAdminClient(createFakeSupabaseClient(db));
    await clearSabremetrics(MATCH_ID);
    assert.deepEqual(db.player_match_sabremetrics!.map((r) => r.player_match_stats_id), [2000]);
  });

  __setTestAdminClient(undefined);
  report();
}

await main();
