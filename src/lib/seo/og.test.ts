/**
 * Regression harness for og.ts's leaderboard-rate call sites — getPlayerMeta and
 * getSeasonMetaLeaderboard (gauntlet branch). Both derive win rate / K-D / RWR / ADR from raw
 * totals and must match `deriveRates()` (util.ts) for the same input, so a duplicate inline
 * reimplementation can't silently reappear. Also covers getMatchMeta()'s injectable-client param —
 * see that test's own comment for why.
 *
 * Run:  npx vitest run src/lib/seo/og.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from '../supabase';
import { createFakeSupabaseClient } from '../test-support/fakeSupabase';
import { buildFakeDb } from '../test-support/fixtures';
import { deriveRates } from '../util';
import { test, report } from '../test-support/miniTest';

const fakeClient = createFakeSupabaseClient(buildFakeDb());
__setTestClient(fakeClient);

import { getPlayerMeta, getSeasonMetaLeaderboard, getMatchMeta } from './og';

function approx(actual: number, expected: number, msg?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, msg ?? `expected ~${expected}, got ${actual}`);
}

async function main() {
  await test('getPlayerMeta(1) — WR/K-D/ADR match deriveRates() for the same totals', async () => {
    const meta = await getPlayerMeta(1);
    assert.notEqual(meta, null);
    // Alice's player_season_leaderboard row: matches_played 1, matches_won 1, kills 20, deaths 15,
    // damage 1881, rounds 22.
    const rates = deriveRates({
      matches_played: 1,
      matches_won: 1,
      total_kills: 20,
      total_deaths: 15,
      total_rounds_played: 22,
      total_rounds_won: 0,
      total_damage: 1881,
    });
    assert.equal(meta!.stats.wr, rates.win_rate_percentage.toFixed(0));
    assert.equal(meta!.stats.kd, rates.kd_ratio.toFixed(2));
    assert.equal(meta!.stats.adr, rates.overall_adr.toFixed(2));
  });

  await test('getSeasonMetaLeaderboard(2) — gauntlet season rates match deriveRates() for the same totals', async () => {
    const rows = await getSeasonMetaLeaderboard(2);
    assert.ok(rows.length > 0);
    // Alice (player 1) in gauntlet season 2 (match 200 only): 1 match, win, 22 kills, 18 deaths,
    // 2112 damage, 24 rounds played, 13 rounds won.
    const alice = rows.find((r) => r.player_name === 'Alice');
    assert.notEqual(alice, undefined);
    const rates = deriveRates({
      matches_played: 1,
      matches_won: 1,
      total_kills: 22,
      total_deaths: 18,
      total_rounds_played: 24,
      total_rounds_won: 13,
      total_damage: 2112,
    });
    approx(alice!.win_rate_percentage, rates.win_rate_percentage);
    approx(alice!.kd_ratio, rates.kd_ratio);
    approx(alice!.rwr_percentage, rates.rwr_percentage);
    approx(alice!.overall_adr, rates.overall_adr);
  });

  await test('getMatchMeta(): works with an explicit client even when the anon singleton is unconfigured', async () => {
    // discord-notify.ts's notify functions pass their own supabaseAdmin here rather than relying on
    // the default — scripts/demo-ingest.ts (the GH Action that auto-commits a demo-derived score)
    // runs as a standalone script with no NEXT_PUBLIC_SUPABASE_ANON_KEY, where the anon singleton
    // can't construct at all. __setTestClient(undefined) simulates exactly that: it stops swapping in
    // a fake client, so any code path that still falls through to the real singleton throws (this
    // process has no Supabase env vars set either). getMatchMeta() must not depend on it.
    __setTestClient(undefined);
    try {
      const meta = await getMatchMeta(100, fakeClient);
      assert.notEqual(meta, null);
    } finally {
      __setTestClient(fakeClient);
    }
  });

  report();
}

await main();
