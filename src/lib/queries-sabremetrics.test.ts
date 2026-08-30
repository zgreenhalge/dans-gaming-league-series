/**
 * Regression harness for queries.ts's sabremetrics functions (#63) — getAllSabremetrics,
 * getSabremetricSeasonTotals — plus the shared Plus-stat composite (#163): aggregateRows,
 * chokeScore, computeLeagueAverages, computePlusStats. That composite used to be duplicated
 * (SabremetricsLeaderboardView.tsx's own copy, and a third, already-drifted copy in
 * scripts/match-context.ts with a stale Utility+ formula and different zero-denominator
 * fallbacks); it now lives here as the one implementation both consume.
 *
 * Run:  npx vitest run src/lib/queries-sabremetrics.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import {
  getAllSabremetrics,
  getSabremetricSeasonTotals,
  aggregateRows,
  chokeScore,
  computeLeagueAverages,
  computePlusStats,
  type SabremetricStatRow,
} from './queries';
import { zeroSabFields as zeroSab, sabremetricStatRow as row } from './test-support/sabFields';
import { test, report } from './test-support/miniTest';

async function main() {
  // --- aggregateRows: sums raw sab fields across a player's matches, unions ct/t splits ---
  await test('aggregateRows: sums kills/deaths/assists/damage across ct+t splits and matches', () => {
    const rows: SabremetricStatRow[] = [
      row({ player_id: 1, match_id: 100, rounds_played: 24, sab: zeroSab({ kills_ct: 5, kills_t: 3, deaths_ct: 4, deaths_t: 2, assists_ct: 1, assists_t: 1, damage_ct: 400, damage_t: 300 }) }),
      row({ player_id: 1, match_id: 200, rounds_played: 26, sab: zeroSab({ kills_ct: 4, kills_t: 6, deaths_ct: 3, deaths_t: 5, assists_ct: 2, assists_t: 0, damage_ct: 350, damage_t: 420 }) }),
    ];
    const [agg] = aggregateRows(rows);
    assert.equal(agg.matches, 2);
    assert.equal(agg.rounds_played, 50);
    assert.equal(agg.kills, 5 + 3 + 4 + 6);
    assert.equal(agg.deaths, 4 + 2 + 3 + 5);
    assert.equal(agg.assists, 1 + 1 + 2 + 0);
    assert.equal(agg.damage, 400 + 300 + 350 + 420);
  });

  await test('aggregateRows: two rows sharing a match_id count as one match, not two', () => {
    const rows: SabremetricStatRow[] = [
      row({ player_id: 1, match_id: 100, rounds_played: 12 }),
      row({ player_id: 1, match_id: 100, rounds_played: 12 }),
    ];
    const [agg] = aggregateRows(rows);
    assert.equal(agg.matches, 1, 'same match_id seen twice is still one match');
    assert.equal(agg.rounds_played, 24, 'rounds still sum regardless');
  });

  await test('aggregateRows: one entry per distinct player_id', () => {
    const rows: SabremetricStatRow[] = [
      row({ player_id: 1, match_id: 100 }),
      row({ player_id: 2, match_id: 100 }),
    ];
    assert.equal(aggregateRows(rows).length, 2);
  });

  await test('aggregateRows: sums blind_duration_dealt across matches (#483)', () => {
    const rows: SabremetricStatRow[] = [
      row({ player_id: 1, match_id: 100, sab: zeroSab({ blind_duration_dealt: 3.5 }) }),
      row({ player_id: 1, match_id: 200, sab: zeroSab({ blind_duration_dealt: 2.25 }) }),
    ];
    const [agg] = aggregateRows(rows);
    assert.equal(agg.blind_duration_dealt, 5.75);
  });

  await test('aggregateRows: retains the raw ct/t split alongside the merged totals (#482)', () => {
    const rows: SabremetricStatRow[] = [
      row({ player_id: 1, match_id: 100, sab: zeroSab({ kills_ct: 5, kills_t: 3, deaths_ct: 4, deaths_t: 2, assists_ct: 1, assists_t: 1, damage_ct: 400, damage_t: 300, headshot_kills_ct: 2, headshot_kills_t: 1 }) }),
      row({ player_id: 1, match_id: 200, sab: zeroSab({ kills_ct: 4, kills_t: 6, deaths_ct: 3, deaths_t: 5, assists_ct: 2, assists_t: 0, damage_ct: 350, damage_t: 420, headshot_kills_ct: 1, headshot_kills_t: 3 }) }),
    ];
    const [agg] = aggregateRows(rows);
    assert.equal(agg.kills_ct, 9);
    assert.equal(agg.kills_t, 9);
    assert.equal(agg.deaths_ct, 7);
    assert.equal(agg.deaths_t, 7);
    assert.equal(agg.assists_ct, 3);
    assert.equal(agg.assists_t, 1);
    assert.equal(agg.damage_ct, 750);
    assert.equal(agg.damage_t, 720);
    assert.equal(agg.headshot_kills_ct, 3);
    assert.equal(agg.headshot_kills_t, 4);
    // The merged totals still union the two halves, unchanged from before the split was retained.
    assert.equal(agg.kills, 18);
    assert.equal(agg.deaths, 14);
    assert.equal(agg.assists, 4);
    assert.equal(agg.damage, 1470);
  });

  // --- chokeScore: 1v1 losses + 2×1v2 losses + 5×2v1 losses ---
  await test('chokeScore weights blown clutches by how big the advantage was', () => {
    const [agg] = aggregateRows([row({
      player_id: 1, match_id: 100,
      sab: zeroSab({ clutch_1v1_attempts: 3, clutch_1v1_wins: 1, clutch_1v2_attempts: 2, clutch_1v2_wins: 0, clutch_2v1_attempts: 1, clutch_2v1_wins: 0 }),
    })]);
    // (3-1) + 2*(2-0) + 5*(1-0) = 2 + 4 + 5 = 11
    assert.equal(chokeScore(agg), 11);
  });

  // --- computeLeagueAverages: volume-weighted, with documented zero-denominator fallbacks ---
  await test('computeLeagueAverages: kdr falls back to total kills when the league has zero deaths', () => {
    const [agg] = aggregateRows([row({ player_id: 1, match_id: 100, sab: zeroSab({ kills_ct: 10, deaths_ct: 0 }) })]);
    const la = computeLeagueAverages([agg]);
    assert.equal(la.kdr, 10, 'fallback is totalKills, not 0/undefined');
  });

  await test('computeLeagueAverages: entry falls back to 0.5 when nobody has an opening duel yet', () => {
    const [agg] = aggregateRows([row({ player_id: 1, match_id: 100 })]);
    const la = computeLeagueAverages([agg]);
    assert.equal(la.entry, 0.5);
  });

  await test('computeLeagueAverages: kpr is volume-weighted (totals over totals, not average of rates)', () => {
    const rows: SabremetricStatRow[] = [
      row({ player_id: 1, match_id: 100, rounds_played: 10, sab: zeroSab({ kills_ct: 20 }) }), // 2.0 kpr, high volume
      row({ player_id: 2, match_id: 100, rounds_played: 100, sab: zeroSab({ kills_ct: 100 }) }), // 1.0 kpr, low-ish
    ];
    const agg = aggregateRows(rows);
    const la = computeLeagueAverages(agg);
    // (20+100) / (10+100) ≈ 1.09, not the unweighted midpoint of 2.0 and 1.0 (1.5)
    assert.ok(Math.abs(la.kpr - 120 / 110) < 1e-9);
  });

  // --- computePlusStats: the actual Plus-stat formulas, including zero-denominator edge cases ---
  await test('computePlusStats: kpr/adr are simple ratios against the league baseline', () => {
    const [agg] = aggregateRows([row({ player_id: 1, match_id: 100, rounds_played: 20, sab: zeroSab({ kills_ct: 20, damage_ct: 1600 }) })]); // 1.0 kpr, 80 adr
    const la = computeLeagueAverages([agg]);
    const plus = computePlusStats(agg, la);
    assert.equal(plus.kpr, 1, 'a lone player is exactly the league average');
    assert.equal(plus.adr, 1);
  });

  await test('computePlusStats: kdr with zero deaths uses raw kills, not null/zero', () => {
    const [agg] = aggregateRows([row({ player_id: 1, match_id: 100, sab: zeroSab({ kills_ct: 10, deaths_ct: 0 }) })]);
    const la = computeLeagueAverages([agg]);
    const plus = computePlusStats(agg, la);
    // league kdr fallback is also totalKills (10) here, so a lone zero-death player is exactly average
    assert.equal(plus.kdr, 1);
  });

  await test('computePlusStats: entry with no opening duels at all is a concrete number, not null', () => {
    const [agg] = aggregateRows([row({ player_id: 1, match_id: 100 })]);
    const la = computeLeagueAverages([agg]);
    const plus = computePlusStats(agg, la);
    assert.equal(typeof plus.entry, 'number');
    assert.ok(Number.isFinite(plus.entry));
  });

  await test('computePlusStats: aim = 0.35*accuracy+ + 0.40*headAccuracy+ + 0.25*counterStrafe+', () => {
    const [leagueAgg] = aggregateRows([row({
      player_id: 1, match_id: 100,
      sab: zeroSab({ shots_fired: 100, shots_hit: 50, shots_hit_no_awp: 50, headshot_hits_no_awp: 25, counter_strafe_shots: 100, counter_strafe_good_shots: 40 }),
    })]);
    const la = computeLeagueAverages([leagueAgg]);
    const plus = computePlusStats(leagueAgg, la);
    assert.ok(Math.abs(plus.aim - (0.35 * 1 + 0.40 * 1 + 0.25 * 1)) < 1e-9, 'lone player vs its own average -> each ratio is 1');
  });

  await test('computePlusStats: utility folds teamflash duration in inverted (lower is better)', () => {
    // Two identical players except player B teamflashes twice as much — B's utility+ must be lower.
    const a = aggregateRows([row({ player_id: 1, match_id: 100, rounds_played: 10, sab: zeroSab({ flash_assists: 5, utility_damage: 100, teamflash_duration: 2 }) })])[0];
    const b = aggregateRows([row({ player_id: 2, match_id: 200, rounds_played: 10, sab: zeroSab({ flash_assists: 5, utility_damage: 100, teamflash_duration: 4 }) })])[0];
    const la = computeLeagueAverages([a, b]);
    const plusA = computePlusStats(a, la);
    const plusB = computePlusStats(b, la);
    assert.ok(plusA.utility > plusB.utility, 'more teamflashing must score lower Utility+, all else equal');
  });

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

  report();
}

await main();
