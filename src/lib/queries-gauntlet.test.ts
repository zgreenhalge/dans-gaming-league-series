/**
 * Regression harness for queries.ts's gauntlet functions (#63) — getGauntletStats,
 * getGauntletSeasonLeaderboard, getGauntletPodForMatch, getGauntletBracketShape,
 * getGauntletRounds, getAllGauntletSummaries.
 *
 * Run:  npx vitest run src/lib/queries-gauntlet.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';
import { test, report } from './test-support/miniTest';
import { deriveRates } from './util';
import type { LeaderboardRowWithId } from './types';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import {
  getGauntletStats,
  getGauntletSeasonLeaderboard,
  getGauntletPodForMatch,
  getGauntletBracketShape,
  getGauntletRounds,
  getAllGauntletSummaries,
  deriveGauntletSeasonLeaderboard,
  getPlayersById,
} from './queries';

/** Guards against a duplicate inline reimplementation of `deriveRates()` silently reappearing. */
function assertRatesMatchDeriveRates(rows: LeaderboardRowWithId[], label: string) {
  for (const r of rows) {
    const rates = deriveRates(r);
    assert.equal(r.win_rate_percentage, rates.win_rate_percentage, `${label}: ${r.player_name} win_rate_percentage`);
    assert.equal(r.kd_ratio, rates.kd_ratio, `${label}: ${r.player_name} kd_ratio`);
    assert.equal(r.rwr_percentage, rates.rwr_percentage, `${label}: ${r.player_name} rwr_percentage`);
    assert.equal(r.overall_adr, rates.overall_adr, `${label}: ${r.player_name} overall_adr`);
  }
}

async function main() {
  await test('getGauntletStats() — career + bySeason across both gauntlets, snapshot', async () => {
    const stats = await getGauntletStats();
    assertRatesMatchDeriveRates(stats.career, 'getGauntletStats().career');
    matchesSnapshot('getGauntletStats', stats);
  });

  await test('getGauntletSeasonLeaderboard(2) — paired gauntlet, snapshot', async () => {
    matchesSnapshot('getGauntletSeasonLeaderboard-2', await getGauntletSeasonLeaderboard(2));
  });

  await test('getGauntletSeasonLeaderboard(4) — orphan gauntlet, snapshot', async () => {
    matchesSnapshot('getGauntletSeasonLeaderboard-4', await getGauntletSeasonLeaderboard(4));
  });

  await test('getGauntletSeasonLeaderboard(1) — non-gauntlet season has no playoff matches', async () => {
    assert.deepEqual(await getGauntletSeasonLeaderboard(1), []);
  });

  await test('getGauntletPodForMatch(200) — pod 1000 has no match2_id yet, so it\'s not fully materialized', async () => {
    // A transient state in real production data (between materializePod()'s two match inserts), kept
    // as a fixture shorthand here since other tests in this file don't need a full two-match pod.
    assert.equal(await getGauntletPodForMatch(200), null);
  });

  await test('getGauntletPodForMatch(100) — non-gauntlet match has no pod', async () => {
    assert.equal(await getGauntletPodForMatch(100), null);
  });

  await test('getGauntletPodForMatch — resolves via the .or() match1/match2 clause once both games are materialized, snapshot', async () => {
    const db = buildFakeDb();
    db.matches.push({ ...db.matches.find((m) => m.id === 200)!, id: 201, match_number: 2, final_score: null, scheduled_at: null });
    // Replace, don't mutate, the pod row — buildFakeDb() returns the same shared fixture row objects
    // every call, so mutating one in place would leak into every other test in this file.
    db.gauntlet_pods = db.gauntlet_pods.map((p) => (p.match1_id === 200 ? { ...p, match2_id: 201 } : p));
    __setTestClient(createFakeSupabaseClient(db));

    const pod = await getGauntletPodForMatch(200);
    assert.notEqual(pod, null);
    matchesSnapshot('getGauntletPodForMatch-200', pod);

    __setTestClient(createFakeSupabaseClient(buildFakeDb())); // restore the module-shared fixture for later tests
  });

  await test('getGauntletBracketShape(2) — one materialized, played, final pod, snapshot', async () => {
    const shape = await getGauntletBracketShape(2);
    assert.equal(shape.length, 1);
    assert.equal(shape[0].played, true);
    assert.equal(shape[0].materialized, true);
    matchesSnapshot('getGauntletBracketShape-2', shape);
  });

  await test('getGauntletBracketShape(1) — regular season has no pods', async () => {
    assert.deepEqual(await getGauntletBracketShape(1), []);
  });

  await test('getGauntletBracketShape() orders a pod\'s slots by seed rank, not raw slot_index', async () => {
    const db = buildFakeDb();
    // A manually-arranged pod, matching the shape a real one can take: slot_index reflects
    // whatever order the pod was drafted in, not the players' seed strength.
    db.gauntlet_pods = [
      ...db.gauntlet_pods,
      { id: 2000, season_id: 99, round_number: 1, pod_index: 0, advance_rule: 'single', is_final: false, week_id: null, match1_id: null, match2_id: null },
    ];
    db.gauntlet_pod_slots = [
      ...db.gauntlet_pod_slots,
      { pod_id: 2000, slot_index: 0, source_kind: 'seed', source_seed: 11, source_pod_id: null, player_id: 13 },
      { pod_id: 2000, slot_index: 1, source_kind: 'seed', source_seed: 10, source_pod_id: null, player_id: 11 },
      { pod_id: 2000, slot_index: 2, source_kind: 'seed', source_seed: 12, source_pod_id: null, player_id: 10 },
      { pod_id: 2000, slot_index: 3, source_kind: 'seed', source_seed: 13, source_pod_id: null, player_id: 12 },
    ];
    __setTestClient(createFakeSupabaseClient(db));

    const shape = await getGauntletBracketShape(99);
    assert.equal(shape.length, 1);
    // Re-ordered to seed 10, 11, 12, 13 (best first) — the same order materializePod() ranks these
    // occupants in when it pairs the pod's two real games — rather than the persisted slot_index
    // order (11, 10, 12, 13).
    assert.deepEqual(shape[0].slots.map((s) => s.source_seed), [10, 11, 12, 13]);
    assert.deepEqual(shape[0].slots.map((s) => s.player_id), [11, 13, 10, 12]);

    __setTestClient(createFakeSupabaseClient(buildFakeDb())); // restore the module-shared fixture for later tests
  });

  await test('getGauntletRounds(2) — one round, one match, snapshot', async () => {
    const rounds = await getGauntletRounds(2);
    assert.equal(rounds.length, 1);
    matchesSnapshot('getGauntletRounds-2', rounds);
  });

  await test('deriveGauntletSeasonLeaderboard() — same result as getGauntletSeasonLeaderboard() from already-fetched rounds', async () => {
    const [rounds, playersById] = await Promise.all([getGauntletRounds(2), getPlayersById()]);
    const derived = deriveGauntletSeasonLeaderboard(rounds, 2, playersById);
    assert.deepEqual(derived, await getGauntletSeasonLeaderboard(2));
  });

  await test('getAllGauntletSummaries() — both gauntlets, snapshot', async () => {
    const summaries = await getAllGauntletSummaries();
    assert.equal(summaries.size, 2);
    matchesSnapshot('getAllGauntletSummaries', summaries);
  });

  report();
}

await main();
