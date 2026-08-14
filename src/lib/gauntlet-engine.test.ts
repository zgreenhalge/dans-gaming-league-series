/**
 * Coverage for the runtime gauntlet engine's DB-touching surface: `materializePod()` (pod ->
 * matches/stats), `resolveAndPropagate()` (score commit -> survivor propagation -> downstream
 * auto-materialization), and `saveManualDraft()` (the manual pod editor's `DraftPod[]` ->
 * gauntlet_pods/gauntlet_pod_slots reconciliation, including its `reconcile_gauntlet_draft` RPC).
 *
 * Both `gauntlet-engine.ts` itself (via its `supabaseAdmin` parameter) and the `./queries` helpers
 * it calls into (`getSeason`, `getLinkedGauntlet`, `getSeasonLeaderboard`, etc. — all built on the
 * module-level `supabase` singleton, not `supabaseAdmin`) must point at the *same* fake db, or the
 * two halves of one call would read/write different in-memory databases — hence wiring both
 * `__setTestClient()` and passing the fake as `supabaseAdmin` in every test below.
 *
 * The `reconcile_gauntlet_draft` RPC has no generic in-memory equivalent (see fakeSupabase.ts's own
 * header comment) — `makeReconcileGauntletDraftRpc()` (test-support/reconcileGauntletDraftRpc.ts,
 * shared with seasons/[id]/gauntlet/pods/route.test.ts) is a test-local fake implementation
 * registered via `createFakeSupabaseClient(db, { reconcile_gauntlet_draft: ... })`, covering exactly
 * the delete/insert/update/slot-rewrite/materialization-race-skip shape `saveManualDraft()` actually
 * calls it with.
 *
 * Run:  npx vitest run src/lib/gauntlet-engine.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient, type FakeDb, type Row, type RpcHandler } from './test-support/fakeSupabase';
import { makeReconcileGauntletDraftRpc } from './test-support/reconcileGauntletDraftRpc';
import { test, report } from './test-support/miniTest';
import { materializePod, resolveAndPropagate, saveManualDraft } from './gauntlet-engine';
import { emptyDraftPod, type DraftPod } from './gauntlet-draft';

// ─── shared fixture plumbing ─────────────────────────────────────────────────

function makePlayers(ids: number[]): Row[] {
  return ids.map((id) => ({ id, name: `Player ${id}`, is_admin: false }));
}

/** Wires `db` up as both the module-level `supabase` singleton (via `__setTestClient()`, for the
 * `./queries`/`gauntlet-engine.ts` helpers built on it) and returns the same client for direct use as
 * a test's `supabaseAdmin` argument — one fake client per fixture, not two independent ones pointed
 * at the same `db`. */
function installFixture(db: FakeDb): ReturnType<typeof createFakeSupabaseClient> {
  const client = createFakeSupabaseClient(db, { reconcile_gauntlet_draft: makeReconcileGauntletDraftRpc() });
  __setTestClient(client);
  return client;
}

function podsOf(db: FakeDb, seasonId: number): Row[] {
  return (db.gauntlet_pods ?? []).filter((p) => p.season_id === seasonId);
}
function slotsOf(db: FakeDb, podId: number): Row[] {
  return (db.gauntlet_pod_slots ?? []).filter((s) => s.pod_id === podId).sort((a, b) => (a.slot_index as number) - (b.slot_index as number));
}

async function main() {
  // ─── materializePod ────────────────────────────────────────────────────────

  await test('materializePod: creates a week, two matches, and 8 zero-stat player rows, ranked by seed', async () => {
  const db: FakeDb = {
    seasons: [],
    weeks: [],
    matches: [],
    player_match_stats: [],
    gauntlet_pods: [{ id: 900, season_id: 20, round_number: 1, pod_index: 0, advance_rule: 'single', is_final: false, week_id: null, match1_id: null, match2_id: null }],
    gauntlet_pod_slots: [],
    players: makePlayers([1, 2, 3, 4]),
  };
  const client = installFixture(db);

  const seedByPlayer = new Map([[1, 1], [2, 2], [3, 3], [4, 4]]);
  await materializePod(client as never, { id: 900, season_id: 20, round_number: 1 }, [
    { player_id: 4 }, { player_id: 2 }, { player_id: 1 }, { player_id: 3 },
  ], seedByPlayer);

  assert.equal(db.weeks.length, 1);
  assert.equal(db.weeks[0].season_id, 20);
  assert.equal(db.weeks[0].week_number, 1);

  assert.equal(db.matches.length, 2);
  assert.ok(db.matches.every((m) => m.is_playoff_game === true && m.final_score === null));
  const [m1, m2] = [...db.matches].sort((a, b) => (a.match_number as number) - (b.match_number as number));
  assert.equal(m1.match_number, 1);
  assert.equal(m2.match_number, 2);

  // ranked by seed: r0=seed1(p1), r1=seed2(p2), r2=seed3(p3), r3=seed4(p4)
  // game1 shirts=[r0,r3]=[1,4] skins=[r1,r2]=[2,3]; game2 shirts=[r0,r2]=[1,3] skins=[r1,r3]=[2,4]
  const statsFor = (matchId: unknown) => db.player_match_stats.filter((s) => s.match_id === matchId);
  const game1 = statsFor(m1.id);
  assert.equal(game1.length, 4);
  assert.deepEqual(game1.find((s) => s.player_id === 1)!.faction, 'SHIRTS');
  assert.deepEqual(game1.find((s) => s.player_id === 4)!.faction, 'SHIRTS');
  assert.deepEqual(game1.find((s) => s.player_id === 2)!.faction, 'SKINS');
  assert.deepEqual(game1.find((s) => s.player_id === 3)!.faction, 'SKINS');
  assert.ok(game1.every((s) => s.kills === 0 && s.is_win === false));

  const pod = db.gauntlet_pods.find((p) => p.id === 900)!;
  assert.equal(pod.week_id, db.weeks[0].id);
  assert.equal(pod.match1_id, m1.id);
  assert.equal(pod.match2_id, m2.id);
});

  await test('materializePod: a concurrent claim (match1_id already set) deletes the orphaned match1 and creates nothing else', async () => {
  const db: FakeDb = {
    seasons: [],
    weeks: [{ id: 1, season_id: 20, week_number: 1, bye_player_id: null }],
    matches: [],
    player_match_stats: [],
    // Already claimed by a "concurrent" winner.
    gauntlet_pods: [{ id: 900, season_id: 20, round_number: 1, pod_index: 0, advance_rule: 'single', is_final: false, week_id: 1, match1_id: 555, match2_id: null }],
    gauntlet_pod_slots: [],
    players: makePlayers([1, 2, 3, 4]),
  };
  const client = installFixture(db);

  await materializePod(client as never, { id: 900, season_id: 20, round_number: 1 }, [
    { player_id: 1 }, { player_id: 2 }, { player_id: 3 }, { player_id: 4 },
  ], new Map([[1, 1], [2, 2], [3, 3], [4, 4]]));

  // Only the orphaned match1 attempt should have existed and then been deleted; match2 and stats
  // never get created for the losing caller.
  assert.equal(db.matches.length, 0);
  assert.equal(db.player_match_stats.length, 0);
  assert.equal(db.gauntlet_pods.find((p) => p.id === 900)!.match2_id, null);
});

// ─── resolveAndPropagate ─────────────────────────────────────────────────────

function twoPodFixture(): FakeDb {
  // Pod A (id 100, round 1, single): already materialized as match1=500 / match2=501, with player 1
  // going 2-0 (the sole "single" survivor) — everyone else 0-1 or 1-1.
  // Pod B (id 200, round 2, Final): slot 0 awaits pod A's survivor; slots 1-3 already seeded to
  // players 5, 6, 7 directly, so the moment slot 0 fills, all 4 are present and pod B should
  // auto-materialize.
  return {
    seasons: [
      { id: 10, name: 'Season 9', status: 'COMPLETED', is_gauntlet: false, target_win_rounds: 13 },
      { id: 20, name: 'Season 9 Gauntlet', status: 'ACTIVE', is_gauntlet: true, target_win_rounds: 13 },
    ],
    weeks: [{ id: 1, season_id: 20, week_number: 1, bye_player_id: null }],
    matches: [
      { id: 500, week_id: 1, match_number: 1, final_score: '13-9', is_playoff_game: true },
      { id: 501, week_id: 1, match_number: 2, final_score: '13-11', is_playoff_game: true },
    ],
    player_match_stats: [
      { id: 1, match_id: 500, player_id: 1, is_win: true },
      { id: 2, match_id: 500, player_id: 4, is_win: true },
      { id: 3, match_id: 500, player_id: 2, is_win: false },
      { id: 4, match_id: 500, player_id: 3, is_win: false },
      { id: 5, match_id: 501, player_id: 1, is_win: true },
      { id: 6, match_id: 501, player_id: 3, is_win: true },
      { id: 7, match_id: 501, player_id: 2, is_win: false },
      { id: 8, match_id: 501, player_id: 4, is_win: false },
    ],
    gauntlet_pods: [
      { id: 100, season_id: 20, round_number: 1, pod_index: 0, advance_rule: 'single', is_final: false, week_id: 1, match1_id: 500, match2_id: 501 },
      { id: 200, season_id: 20, round_number: 2, pod_index: 0, advance_rule: 'single', is_final: true, week_id: null, match1_id: null, match2_id: null },
    ],
    gauntlet_pod_slots: [
      { id: 1, pod_id: 100, slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: 1 },
      { id: 2, pod_id: 100, slot_index: 1, source_kind: 'seed', source_seed: 2, source_pod_id: null, player_id: 2 },
      { id: 3, pod_id: 100, slot_index: 2, source_kind: 'seed', source_seed: 3, source_pod_id: null, player_id: 3 },
      { id: 4, pod_id: 100, slot_index: 3, source_kind: 'seed', source_seed: 4, source_pod_id: null, player_id: 4 },
      { id: 5, pod_id: 200, slot_index: 0, source_kind: 'pod', source_seed: null, source_pod_id: 100, player_id: null },
      { id: 6, pod_id: 200, slot_index: 1, source_kind: 'seed', source_seed: 5, source_pod_id: null, player_id: 5 },
      { id: 7, pod_id: 200, slot_index: 2, source_kind: 'seed', source_seed: 6, source_pod_id: null, player_id: 6 },
      { id: 8, pod_id: 200, slot_index: 3, source_kind: 'seed', source_seed: 7, source_pod_id: null, player_id: 7 },
    ],
    players: makePlayers([1, 2, 3, 4, 5, 6, 7]),
  };
}

  await test('resolveAndPropagate: the single-elim 2-0 survivor is written into the downstream slot, which auto-materializes once full', async () => {
  const db = twoPodFixture();
  const client = installFixture(db);

  await resolveAndPropagate(client as never, 500);

  const podBSlot0 = db.gauntlet_pod_slots.find((s) => s.pod_id === 200 && s.slot_index === 0)!;
  assert.equal(podBSlot0.player_id, 1);

  const podB = db.gauntlet_pods.find((p) => p.id === 200)!;
  assert.ok(podB.match1_id != null, 'pod B should have materialized once all 4 slots filled');
  assert.ok(podB.match2_id != null);
  assert.equal(db.weeks.filter((w) => w.season_id === 20).length, 2, 'a new week for round 2 should have been created');
});

  await test('resolveAndPropagate: a wildcard pod advances every player with at least one win, up to downstream capacity', async () => {
  const db: FakeDb = {
    seasons: [
      { id: 10, name: 'Season 9', status: 'COMPLETED', is_gauntlet: false, target_win_rounds: 13 },
      { id: 20, name: 'Season 9 Gauntlet', status: 'ACTIVE', is_gauntlet: true, target_win_rounds: 13 },
    ],
    weeks: [{ id: 1, season_id: 20, week_number: 1, bye_player_id: null }],
    matches: [
      { id: 500, week_id: 1, match_number: 1, final_score: '13-9', is_playoff_game: true },
      { id: 501, week_id: 1, match_number: 2, final_score: '13-11', is_playoff_game: true },
    ],
    // Wildcard pod: players 1 and 2 each win exactly one game (1 win each -> both survive);
    // players 3 and 4 win nothing.
    player_match_stats: [
      { id: 1, match_id: 500, player_id: 1, is_win: true },
      { id: 2, match_id: 500, player_id: 4, is_win: false },
      { id: 3, match_id: 500, player_id: 2, is_win: false },
      { id: 4, match_id: 500, player_id: 3, is_win: false },
      { id: 5, match_id: 501, player_id: 1, is_win: false },
      { id: 6, match_id: 501, player_id: 3, is_win: false },
      { id: 7, match_id: 501, player_id: 2, is_win: true },
      { id: 8, match_id: 501, player_id: 4, is_win: false },
    ],
    gauntlet_pods: [
      { id: 100, season_id: 20, round_number: 1, pod_index: 0, advance_rule: 'wildcard', is_final: false, week_id: 1, match1_id: 500, match2_id: 501 },
      { id: 200, season_id: 20, round_number: 2, pod_index: 0, advance_rule: 'single', is_final: true, week_id: null, match1_id: null, match2_id: null },
    ],
    gauntlet_pod_slots: [
      { id: 1, pod_id: 100, slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: 1 },
      { id: 2, pod_id: 100, slot_index: 1, source_kind: 'seed', source_seed: 2, source_pod_id: null, player_id: 2 },
      { id: 3, pod_id: 100, slot_index: 2, source_kind: 'seed', source_seed: 3, source_pod_id: null, player_id: 3 },
      { id: 4, pod_id: 100, slot_index: 3, source_kind: 'seed', source_seed: 4, source_pod_id: null, player_id: 4 },
      { id: 5, pod_id: 200, slot_index: 0, source_kind: 'pod', source_seed: null, source_pod_id: 100, player_id: null },
      { id: 6, pod_id: 200, slot_index: 1, source_kind: 'pod', source_seed: null, source_pod_id: 100, player_id: null },
      { id: 7, pod_id: 200, slot_index: 2, source_kind: 'seed', source_seed: 5, source_pod_id: null, player_id: 5 },
      { id: 8, pod_id: 200, slot_index: 3, source_kind: 'seed', source_seed: 6, source_pod_id: null, player_id: 6 },
    ],
    players: makePlayers([1, 2, 3, 4, 5, 6]),
  };
  const client = installFixture(db);

  await resolveAndPropagate(client as never, 500);

  const filled = db.gauntlet_pod_slots.filter((s) => s.pod_id === 200 && (s.slot_index === 0 || s.slot_index === 1)).map((s) => s.player_id);
  assert.deepEqual(filled.sort(), [1, 2]);
});

  await test('resolveAndPropagate: no-ops when the pod is the Final (nobody advances from it)', async () => {
  const db = twoPodFixture();
  // Make pod A itself the Final so propagation must not touch anything.
  db.gauntlet_pods.find((p) => p.id === 100)!.is_final = true;
  const client = installFixture(db);
  const before = JSON.stringify(db.gauntlet_pod_slots);

  await resolveAndPropagate(client as never, 500);
  assert.equal(JSON.stringify(db.gauntlet_pod_slots), before);
});

  await test('resolveAndPropagate: no-ops while the pod\'s other match is still unplayed', async () => {
  const db = twoPodFixture();
  db.matches.find((m) => m.id === 501)!.final_score = null;
  const client = installFixture(db);

  await resolveAndPropagate(client as never, 500);
  const podBSlot0 = db.gauntlet_pod_slots.find((s) => s.pod_id === 200 && s.slot_index === 0)!;
  assert.equal(podBSlot0.player_id, null);
});

  await test('resolveAndPropagate: no-ops for a match that isn\'t linked to any pod', async () => {
  const db = twoPodFixture();
  const client = installFixture(db);
  // Should simply return without throwing.
  await resolveAndPropagate(client as never, 99999);
});

// ─── saveManualDraft ─────────────────────────────────────────────────────────

function draftFixtureDb(): FakeDb {
  return {
    seasons: [{ id: 30, name: 'Season 11', status: 'COMPLETED', is_gauntlet: false, target_win_rounds: 13 }],
    weeks: [],
    matches: [],
    player_match_stats: [],
    gauntlet_pods: [],
    gauntlet_pod_slots: [],
    players: makePlayers([1, 2, 3, 4]),
    // Seeds 1-4 map straight to player_id 1-4 via descending win_rate_percentage.
    player_season_leaderboard: [1, 2, 3, 4].map((id, i) => ({
      season_id: 30, player_id: id, player_name: `Player ${id}`, matches_played: 1, matches_won: 1, matches_lost: 0,
      win_rate_percentage: 100 - i * 10, total_kills: 0, total_deaths: 0, kd_ratio: 0, total_damage: 0, total_rounds_played: 0,
    })),
  };
}

function draftPod(overrides: Partial<DraftPod> & { key: string }): DraftPod {
  return { ...emptyDraftPod(overrides.key, overrides.round_number ?? 1, overrides.pod_index ?? 0), ...overrides };
}

  await test('saveManualDraft: an integrity violation is rejected before touching the database', async () => {
  const db = draftFixtureDb();
  const client = installFixture(db);

  const pods: DraftPod[] = [draftPod({ key: 'a', is_final: true }), draftPod({ key: 'b', is_final: true })];
  const result = await saveManualDraft(client as never, 30, pods);
  assert.equal(result.status, 'invalid');
  assert.equal(db.gauntlet_pods.length, 0);
  assert.equal(db.seasons.length, 1, 'no gauntlet season should have been created');
});

  await test('saveManualDraft: a missing regular season is not-eligible', async () => {
  const db = draftFixtureDb();
  const client = installFixture(db);

  const result = await saveManualDraft(client as never, 99999, [draftPod({ key: 'a' })]);
  assert.deepEqual(result, { status: 'not-eligible', reason: 'Regular season not found' });
});

  await test('saveManualDraft: a seed number the current roster can\'t resolve is rejected', async () => {
  const db = draftFixtureDb();
  const client = installFixture(db);

  const pods: DraftPod[] = [
    draftPod({ key: 'a', is_final: true, slots: [{ kind: 'seed', seed: 99 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] }),
  ];
  const result = await saveManualDraft(client as never, 30, pods);
  assert.equal(result.status, 'invalid');
  assert.ok(result.status === 'invalid' && result.errors[0].includes('Seed 99'));
});

  await test('saveManualDraft: first save creates the paired gauntlet season, persists pods/slots, and materializes a fully-seeded pod', async () => {
  const db = draftFixtureDb();
  const client = installFixture(db);

  const pods: DraftPod[] = [
    draftPod({
      key: 'r1',
      round_number: 1,
      pod_index: 0,
      advance_rule: 'single',
      slots: [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 2 }, { kind: 'seed', seed: 3 }, { kind: 'seed', seed: 4 }],
    }),
    draftPod({
      key: 'final',
      round_number: 2,
      pod_index: 0,
      is_final: true,
      slots: [{ kind: 'advance', sourcePodKey: 'r1', ordinal: 0 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }],
    }),
  ];

  const result = await saveManualDraft(client as never, 30, pods);
  assert.equal(result.status, 'saved');
  assert.ok(result.status === 'saved');

  const gauntletSeason = db.seasons.find((s) => s.is_gauntlet);
  assert.ok(gauntletSeason);
  assert.equal(gauntletSeason!.name, 'Season 11 Gauntlet');
  assert.equal(result.status === 'saved' ? result.gauntletSeasonId : null, gauntletSeason!.id);

  assert.equal(podsOf(db, gauntletSeason!.id as number).length, 2);
  const r1 = db.gauntlet_pods.find((p) => p.round_number === 1)!;
  const final = db.gauntlet_pods.find((p) => p.is_final)!;

  // r1's seed slots resolved to real player_ids via the leaderboard (seed i -> player i).
  assert.deepEqual(slotsOf(db, r1.id as number).map((s) => s.player_id), [1, 2, 3, 4]);
  // final's advance slot references r1 and has no player yet (nothing has been played).
  const finalSlots = slotsOf(db, final.id as number);
  assert.equal(finalSlots[0].source_kind, 'pod');
  assert.equal(finalSlots[0].source_pod_id, r1.id);
  assert.equal(finalSlots[0].player_id, null);

  // r1 was fully seeded and the regular season is COMPLETED -> it should have materialized.
  assert.ok(r1.match1_id != null, 'r1 should have materialized');
  assert.equal(final.match1_id, null, 'final is still missing 3 slots, so it should not materialize');
});

  await test('saveManualDraft: a pod that materializes between the initial read and the reconcile RPC is skipped, reported as a warning, and left untouched', async () => {
    const db = draftFixtureDb();
    // Persisted but NOT YET materialized when saveManualDraft does its initial getGauntletBracketShape()
    // read — this is what makes the pod eligible for update/slot-rewrite in the first place.
    db.seasons.push({ id: 40, name: 'Season 11 Gauntlet', status: 'ACTIVE', is_gauntlet: true, target_win_rounds: 13 });
    db.gauntlet_pods.push({ id: 500, season_id: 40, round_number: 1, pod_index: 0, advance_rule: 'single', is_final: false, week_id: null, match1_id: null, match2_id: null });
    db.gauntlet_pod_slots.push(
      { id: 1, pod_id: 500, slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: 1 },
      { id: 2, pod_id: 500, slot_index: 1, source_kind: 'seed', source_seed: 2, source_pod_id: null, player_id: 2 },
      { id: 3, pod_id: 500, slot_index: 2, source_kind: 'seed', source_seed: 3, source_pod_id: null, player_id: 3 },
      { id: 4, pod_id: 500, slot_index: 3, source_kind: 'seed', source_seed: 4, source_pod_id: null, player_id: 4 },
    );
    // A one-off RPC handler that simulates a concurrent resolveAndPropagate() materializing pod 500
    // in the gap between saveManualDraft()'s initial read and this RPC call actually landing — the
    // exact race `reconcile_gauntlet_draft()`'s own re-check (mirrored by the shared fake's
    // isMaterialized() guard) exists to protect against, per gauntlet-engine.ts's comment above the
    // RPC call. Needs its own client (installFixture()'s default RPC handler won't do), wired as both
    // the singleton and the direct supabaseAdmin argument, same as installFixture() does internally.
    const baseRpc = makeReconcileGauntletDraftRpc();
    const raceRpc: RpcHandler = (args, rpcDb) => {
      const pod = rpcDb.gauntlet_pods.find((p) => p.id === 500);
      if (pod) {
        pod.match1_id = 700;
        pod.match2_id = 701;
      }
      return baseRpc(args, rpcDb);
    };
    const client = createFakeSupabaseClient(db, { reconcile_gauntlet_draft: raceRpc });
    __setTestClient(client);

    // The submitted draft still carries this pod (persistedId 500) and tries to change its
    // advance_rule to 'wildcard' — since it materialized behind the scenes, the RPC should skip it.
    const pods: DraftPod[] = [
      draftPod({
        key: '500',
        persistedId: 500,
        round_number: 1,
        pod_index: 0,
        advance_rule: 'wildcard',
        slots: [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 2 }, { kind: 'seed', seed: 3 }, { kind: 'seed', seed: 4 }],
      }),
    ];

    const result = await saveManualDraft(client as never, 30, pods);
    assert.equal(result.status, 'saved');
    assert.ok(result.status === 'saved' && result.warnings?.some((w) => w.includes('started playing while you were editing')));

    const pod = db.gauntlet_pods.find((p) => p.id === 500)!;
    assert.equal(pod.advance_rule, 'single', 'a pod that raced to materialized must not have its advance_rule changed underneath the live match');
    assert.equal(pod.match1_id, 700, 'the race-injected materialization itself must survive untouched');
  });
}

await main().then(report);
