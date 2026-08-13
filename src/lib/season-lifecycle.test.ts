/**
 * Coverage for season status transitions and their gauntlet side effects: activateSeason() (explicit
 * admin UPCOMING -> ACTIVE, plus its best-effort gauntlet-build), checkSeasonCompletion() (auto
 * ACTIVE -> COMPLETED once every match is played, plus its best-effort gauntlet auto-seed), and
 * checkGauntletCompletion() (auto -> ARCHIVED once the gauntlet's Final pod is decided, archiving
 * both the gauntlet and its paired regular season).
 *
 * Both this file's functions (via their `supabaseAdmin` parameter) and the `./queries`/
 * `gauntlet-engine.ts` helpers they call into (many built on the module-level `supabase` singleton,
 * not `supabaseAdmin`) must point at the same fake db — hence wiring both `__setTestClient()` and
 * passing the fake as `supabaseAdmin` in every test below.
 *
 * Run:  npx tsx src/lib/season-lifecycle.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient, type FakeDb } from './test-support/fakeSupabase';
import { test, report } from './test-support/miniTest';
import { activateSeason, checkSeasonCompletion, checkGauntletCompletion } from './season-lifecycle';

function makePlayers(ids: number[]): FakeDb['players'] {
  return ids.map((id) => ({ id, name: `Player ${id}`, is_admin: false }));
}

function leaderboardFor(seasonId: number, playerIds: number[]): FakeDb['player_season_leaderboard'] {
  return playerIds.map((id, i) => ({ season_id: seasonId, player_id: id, player_name: `Player ${id}`, win_rate_percentage: 100 - i * 10 }));
}

function installFixture(db: FakeDb): ReturnType<typeof createFakeSupabaseClient> {
  const client = createFakeSupabaseClient(db);
  __setTestClient(client);
  return client;
}

function opsErrorFor(db: FakeDb, entityId: number, operation: string) {
  return db.ops_errors.filter((e) => e.entity_id === entityId && e.operation === operation && e.dismissed_at == null);
}

// ─── activateSeason ──────────────────────────────────────────────────────────

async function testActivateSeason() {
  await test('activateSeason: transitions UPCOMING -> ACTIVE and builds an eligible gauntlet bracket', async () => {
    const db: FakeDb = {
      players: makePlayers([1, 2, 3, 4]),
      seasons: [{ id: 10, name: 'Season 70', status: 'UPCOMING', is_gauntlet: false, target_win_rounds: 13 }],
      player_season_leaderboard: leaderboardFor(10, [1, 2, 3, 4]),
      gauntlet_pods: [],
      gauntlet_pod_slots: [],
      ops_errors: [],
    };
    const client = installFixture(db);
    const result = await activateSeason(client as never, 10);
    assert.deepEqual(result, { gauntletBuilt: true, gauntletBuildError: null });
    assert.equal(db.seasons.find((s) => s.id === 10)!.status, 'ACTIVE');
    assert.ok(db.seasons.some((s) => s.is_gauntlet && s.name === 'Season 70 Gauntlet'));
  });

  await test('activateSeason: still activates when the gauntlet build isn\'t eligible, and records an ops-error', async () => {
    const db: FakeDb = {
      players: [],
      seasons: [{ id: 11, name: 'Season 71', status: 'UPCOMING', is_gauntlet: false, target_win_rounds: 13 }],
      player_season_leaderboard: [], // N=0 -> buildGauntletBracket throws -> not-eligible
      gauntlet_pods: [],
      gauntlet_pod_slots: [],
      ops_errors: [],
    };
    const client = installFixture(db);
    const result = await activateSeason(client as never, 11);
    assert.equal(result.gauntletBuilt, false);
    assert.ok(result.gauntletBuildError);
    assert.equal(db.seasons.find((s) => s.id === 11)!.status, 'ACTIVE');
    assert.equal(opsErrorFor(db, 11, 'gauntlet_build').length, 1);
  });

  await test('activateSeason: reports "already exists" when the season already has a paired gauntlet', async () => {
    const db: FakeDb = {
      players: [],
      seasons: [
        { id: 12, name: 'Season 72', status: 'UPCOMING', is_gauntlet: false, target_win_rounds: 13 },
        { id: 13, name: 'Season 72 Gauntlet', status: 'ACTIVE', is_gauntlet: true, target_win_rounds: 13 },
      ],
      player_season_leaderboard: [],
      gauntlet_pods: [],
      gauntlet_pod_slots: [],
      ops_errors: [],
    };
    const client = installFixture(db);
    const result = await activateSeason(client as never, 12);
    assert.equal(result.gauntletBuilt, false);
    assert.equal(result.gauntletBuildError, 'A gauntlet already exists for this season');
    assert.equal(db.seasons.find((s) => s.id === 12)!.status, 'ACTIVE');
  });
}

// ─── checkSeasonCompletion ───────────────────────────────────────────────────

function playedSeasonFixture(overrides: Partial<FakeDb['seasons'][number]> = {}): FakeDb {
  return {
    players: makePlayers([1, 2, 3, 4]),
    seasons: [{ id: 20, name: 'Season 80', status: 'ACTIVE', is_gauntlet: false, target_win_rounds: 13, ...overrides }],
    weeks: [{ id: 1, season_id: 20, week_number: 1, bye_player_id: null }],
    matches: [{ id: 100, week_id: 1, match_number: 1, final_score: '13-9' }],
    player_season_leaderboard: leaderboardFor(20, [1, 2, 3, 4]),
    gauntlet_pods: [],
    gauntlet_pod_slots: [],
    ops_errors: [],
  };
}

async function testCheckSeasonCompletion() {
  await test('checkSeasonCompletion: no-op for a missing season', async () => {
    const db = playedSeasonFixture();
    const client = installFixture(db);
    await checkSeasonCompletion(client as never, 99999);
    assert.equal(db.seasons[0].status, 'ACTIVE');
  });

  await test('checkSeasonCompletion: no-op for a gauntlet season', async () => {
    const db = playedSeasonFixture({ is_gauntlet: true });
    const client = installFixture(db);
    await checkSeasonCompletion(client as never, 20);
    assert.equal(db.seasons[0].status, 'ACTIVE');
  });

  await test('checkSeasonCompletion: no-op for a season that isn\'t ACTIVE', async () => {
    const db = playedSeasonFixture({ status: 'UPCOMING' });
    const client = installFixture(db);
    await checkSeasonCompletion(client as never, 20);
    assert.equal(db.seasons[0].status, 'UPCOMING');
  });

  await test('checkSeasonCompletion: no-op while a match is still unplayed', async () => {
    const db = playedSeasonFixture();
    db.matches.push({ id: 101, week_id: 1, match_number: 2, final_score: null });
    const client = installFixture(db);
    await checkSeasonCompletion(client as never, 20);
    assert.equal(db.seasons[0].status, 'ACTIVE');
  });

  await test('checkSeasonCompletion: marks COMPLETED and seeds an already-built paired gauntlet', async () => {
    const db = playedSeasonFixture();
    db.seasons.push({ id: 21, name: 'Season 80 Gauntlet', status: 'ACTIVE', is_gauntlet: true, target_win_rounds: 13 });
    db.gauntlet_pods!.push({ id: 500, season_id: 21, round_number: 1, pod_index: 0, advance_rule: 'single', is_final: true, week_id: null, match1_id: null, match2_id: null });
    db.gauntlet_pod_slots!.push(
      { id: 1, pod_id: 500, slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: null },
      { id: 2, pod_id: 500, slot_index: 1, source_kind: 'seed', source_seed: 2, source_pod_id: null, player_id: null },
      { id: 3, pod_id: 500, slot_index: 2, source_kind: 'seed', source_seed: 3, source_pod_id: null, player_id: null },
      { id: 4, pod_id: 500, slot_index: 3, source_kind: 'seed', source_seed: 4, source_pod_id: null, player_id: null },
    );
    const client = installFixture(db);
    await checkSeasonCompletion(client as never, 20);

    assert.equal(db.seasons.find((s) => s.id === 20)!.status, 'COMPLETED');
    const slots = db.gauntlet_pod_slots!.filter((s) => s.pod_id === 500).sort((a, b) => (a.slot_index as number) - (b.slot_index as number));
    assert.deepEqual(slots.map((s) => s.player_id), [1, 2, 3, 4]);
  });

  await test('checkSeasonCompletion: still completes the season, but records drift when the roster no longer matches the built shape', async () => {
    const db = playedSeasonFixture();
    db.seasons.push({ id: 22, name: 'Season 80 Gauntlet', status: 'ACTIVE', is_gauntlet: true, target_win_rounds: 13 });
    // Shape only expects 2 qualifiers; the season now has 4.
    db.gauntlet_pods!.push({ id: 501, season_id: 22, round_number: 1, pod_index: 0, advance_rule: 'single', is_final: true, week_id: null, match1_id: null, match2_id: null });
    db.gauntlet_pod_slots!.push(
      { id: 5, pod_id: 501, slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: null },
      { id: 6, pod_id: 501, slot_index: 1, source_kind: 'seed', source_seed: 2, source_pod_id: null, player_id: null },
    );
    const client = installFixture(db);
    await checkSeasonCompletion(client as never, 20);

    assert.equal(db.seasons.find((s) => s.id === 20)!.status, 'COMPLETED');
    assert.equal(opsErrorFor(db, 20, 'gauntlet_seed').length, 1);
    assert.ok((opsErrorFor(db, 20, 'gauntlet_seed')[0].message as string).includes('drifted'));
  });
}

// ─── checkGauntletCompletion ─────────────────────────────────────────────────

function decidedGauntletFixture(): FakeDb {
  return {
    players: makePlayers([1, 2]),
    seasons: [
      { id: 30, name: 'Season 90', status: 'ACTIVE', is_gauntlet: false, target_win_rounds: 13 },
      { id: 31, name: 'Season 90 Gauntlet', status: 'ACTIVE', is_gauntlet: true, target_win_rounds: 13 },
    ],
    weeks: [{ id: 1, season_id: 31, week_number: 1, bye_player_id: null }],
    matches: [
      { id: 100, week_id: 1, match_number: 1, final_score: '13-9' },
      { id: 101, week_id: 1, match_number: 2, final_score: '13-11' },
    ],
    gauntlet_pods: [{ id: 600, season_id: 31, round_number: 1, pod_index: 0, advance_rule: 'single', is_final: true, week_id: 1, match1_id: 100, match2_id: 101 }],
    gauntlet_pod_slots: [],
    ops_errors: [],
  };
}

async function testCheckGauntletCompletion() {
  await test('checkGauntletCompletion: no-op for a missing or non-gauntlet season', async () => {
    const db = decidedGauntletFixture();
    const client = installFixture(db);
    await checkGauntletCompletion(client as never, 30); // 30 is the regular season, not a gauntlet
    assert.equal(db.seasons.find((s) => s.id === 30)!.status, 'ACTIVE');
  });

  await test('checkGauntletCompletion: no-op while a gauntlet match is still unplayed', async () => {
    const db = decidedGauntletFixture();
    db.matches.find((m) => m.id === 101)!.final_score = null;
    const client = installFixture(db);
    await checkGauntletCompletion(client as never, 31);
    assert.equal(db.seasons.find((s) => s.id === 31)!.status, 'ACTIVE');
  });

  await test('checkGauntletCompletion: no-op while the Final pod itself isn\'t decided', async () => {
    const db = decidedGauntletFixture();
    db.gauntlet_pods.find((p) => p.id === 600)!.match2_id = null; // Final not fully materialized
    const client = installFixture(db);
    await checkGauntletCompletion(client as never, 31);
    assert.equal(db.seasons.find((s) => s.id === 31)!.status, 'ACTIVE');
  });

  await test('checkGauntletCompletion: archives both the gauntlet and its paired regular season', async () => {
    const db = decidedGauntletFixture();
    const client = installFixture(db);
    await checkGauntletCompletion(client as never, 31);
    assert.equal(db.seasons.find((s) => s.id === 31)!.status, 'ARCHIVED');
    assert.equal(db.seasons.find((s) => s.id === 30)!.status, 'ARCHIVED');
  });

  await test('checkGauntletCompletion: idempotent once both are already archived', async () => {
    const db = decidedGauntletFixture();
    db.seasons.find((s) => s.id === 30)!.status = 'ARCHIVED';
    db.seasons.find((s) => s.id === 31)!.status = 'ARCHIVED';
    const client = installFixture(db);
    await checkGauntletCompletion(client as never, 31); // must not throw
    assert.equal(db.seasons.find((s) => s.id === 30)!.status, 'ARCHIVED');
  });

  await test('checkGauntletCompletion: a partial prior archive only redoes the outstanding half', async () => {
    const db = decidedGauntletFixture();
    db.seasons.find((s) => s.id === 31)!.status = 'ARCHIVED'; // gauntlet already archived last time
    // regular season (30) still ACTIVE — as if archiving it failed on a previous attempt
    const client = installFixture(db);
    await checkGauntletCompletion(client as never, 31);
    assert.equal(db.seasons.find((s) => s.id === 30)!.status, 'ARCHIVED');
  });
}

async function main() {
  await testActivateSeason();
  await testCheckSeasonCompletion();
  await testCheckGauntletCompletion();
  report();
}

main();
