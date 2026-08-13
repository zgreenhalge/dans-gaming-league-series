/**
 * Unit tests for `src/lib/demo/liveScore.ts`: the pure `rowToLiveScore()`/`createLiveScoreGuard()`
 * helpers, and the DB-touching `putLiveScoreEvent()`/`getLiveScore()`/`clearLiveScore()`/
 * `clearLiveScoreBestEffort()` against `fakeSupabase.ts`. `pullDemoAndClearLiveScore()` is not
 * covered here — it wraps `ensureDemoInR2()`'s real DatHost/R2 IO, out of scope per
 * `docs/patterns.md`'s "test external IO by extracting the logic around it" convention.
 *
 * Run:  npx tsx src/lib/demo/liveScore.test.ts
 */

import assert from 'node:assert/strict';
import {
  rowToLiveScore,
  createLiveScoreGuard,
  putLiveScoreEvent,
  getLiveScore,
  clearLiveScore,
  clearLiveScoreBestEffort,
} from './liveScore';
import { createFakeSupabaseClient, type FakeDb } from '../test-support/fakeSupabase';
import { test, report } from '../test-support/miniTest';

const MATCH_ID = 100;

// --- rowToLiveScore: snake_case DB row -> camelCase ---
test('rowToLiveScore: maps DB columns to the camelCase shape', () => {
  const row = rowToLiveScore(MATCH_ID, { shirts_score: 5, skins_score: 3, round: 8, updated_at: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(row, { matchId: MATCH_ID, shirts: 5, skins: 3, round: 8, updatedAt: '2026-01-01T00:00:00.000Z' });
});

// --- createLiveScoreGuard: out-of-order update protection ---
test('createLiveScoreGuard: a newer version for the same match is accepted, an older one is not', () => {
  const accept = createLiveScoreGuard();
  assert.equal(accept(MATCH_ID, '2026-01-01T00:00:01.000Z'), true);
  assert.equal(accept(MATCH_ID, '2026-01-01T00:00:00.000Z'), false); // older — race loser
  assert.equal(accept(MATCH_ID, '2026-01-01T00:00:02.000Z'), true); // newer
});

test('createLiveScoreGuard: once deleted, nothing else for that match is accepted', () => {
  const accept = createLiveScoreGuard();
  assert.equal(accept(MATCH_ID, '2026-01-01T00:00:00.000Z'), true);
  assert.equal(accept(MATCH_ID, 'deleted'), true);
  assert.equal(accept(MATCH_ID, '2026-01-01T00:00:05.000Z'), false); // a live score never comes back
});

test('createLiveScoreGuard: an update for a different match is always accepted', () => {
  const accept = createLiveScoreGuard();
  accept(MATCH_ID, 'deleted');
  assert.equal(accept(MATCH_ID + 1, '2026-01-01T00:00:00.000Z'), true); // unambiguously fresh
});

// --- putLiveScoreEvent / getLiveScore: parse + upsert round trip ---
async function main() {
  await test('putLiveScoreEvent: going_live seeds the row at 0-0 with no round', async () => {
    const db: FakeDb = { live_match_score: [] };
    const supabase = createFakeSupabaseClient(db);
    await putLiveScoreEvent(supabase, { event: 'going_live', matchid: MATCH_ID });
    const row = await getLiveScore(supabase, MATCH_ID);
    assert.equal(row!.shirts, 0);
    assert.equal(row!.skins, 0);
    assert.equal(row!.round, null);
  });

  await test('putLiveScoreEvent: round_end upserts the running score and round number', async () => {
    const db: FakeDb = { live_match_score: [] };
    const supabase = createFakeSupabaseClient(db);
    await putLiveScoreEvent(supabase, {
      event: 'round_end', matchid: MATCH_ID, round_number: 5,
      team1: { score: 3 }, team2: { score: 2 },
    });
    const row = await getLiveScore(supabase, MATCH_ID);
    assert.equal(row!.shirts, 3);
    assert.equal(row!.skins, 2);
    assert.equal(row!.round, 5);
  });

  await test('putLiveScoreEvent: map_result upserts the final score (no round number)', async () => {
    const db: FakeDb = { live_match_score: [] };
    const supabase = createFakeSupabaseClient(db);
    await putLiveScoreEvent(supabase, { event: 'map_result', matchid: MATCH_ID, team1: { score: 13 }, team2: { score: 9 } });
    const row = await getLiveScore(supabase, MATCH_ID);
    assert.equal(row!.shirts, 13);
    assert.equal(row!.round, null);
  });

  await test('putLiveScoreEvent: a second event for the same match overwrites, not duplicates, the row', async () => {
    const db: FakeDb = { live_match_score: [] };
    const supabase = createFakeSupabaseClient(db);
    await putLiveScoreEvent(supabase, { event: 'going_live', matchid: MATCH_ID });
    await putLiveScoreEvent(supabase, { event: 'round_end', matchid: MATCH_ID, round: 1, team1: { score: 1 }, team2: { score: 0 } });
    assert.equal(db.live_match_score!.length, 1);
    assert.equal((await getLiveScore(supabase, MATCH_ID))!.shirts, 1);
  });

  await test('putLiveScoreEvent: an unrelated event type is a no-op', async () => {
    const db: FakeDb = { live_match_score: [] };
    const supabase = createFakeSupabaseClient(db);
    await putLiveScoreEvent(supabase, { event: 'series_start', matchid: MATCH_ID });
    assert.equal(db.live_match_score!.length, 0);
  });

  await test('getLiveScore: null when no row exists for the match', async () => {
    const supabase = createFakeSupabaseClient({ live_match_score: [] });
    assert.equal(await getLiveScore(supabase, MATCH_ID), null);
  });

  await test('clearLiveScore: removes the row for the match, leaving others untouched', async () => {
    const db: FakeDb = {
      live_match_score: [
        { match_id: MATCH_ID, shirts_score: 5, skins_score: 3, round: 10, updated_at: '2026-01-01T00:00:00.000Z' },
        { match_id: MATCH_ID + 1, shirts_score: 1, skins_score: 1, round: 2, updated_at: '2026-01-01T00:00:00.000Z' },
      ],
    };
    const supabase = createFakeSupabaseClient(db);
    await clearLiveScore(supabase, MATCH_ID);
    assert.equal(await getLiveScore(supabase, MATCH_ID), null);
    assert.ok(await getLiveScore(supabase, MATCH_ID + 1));
  });

  await test('clearLiveScoreBestEffort: clears the row and dismisses a stale live_score_clear ops error', async () => {
    const db: FakeDb = {
      live_match_score: [{ match_id: MATCH_ID, shirts_score: 5, skins_score: 3, round: 10, updated_at: '2026-01-01T00:00:00.000Z' }],
      ops_errors: [{ entity_type: 'match', entity_id: MATCH_ID, operation: 'live_score_clear', message: 'prior failure', occurred_at: '2026-01-01T00:00:00.000Z', dismissed_at: null }],
    };
    const supabase = createFakeSupabaseClient(db);
    await clearLiveScoreBestEffort(supabase, MATCH_ID);
    assert.equal(await getLiveScore(supabase, MATCH_ID), null);
    assert.ok(db.ops_errors![0].dismissed_at !== null, 'the live ops error should be dismissed on success');
  });

  report();
}

main();
