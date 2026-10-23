/**
 * Regression harness for queries.ts's player-core functions (#63) — getPlayer, getPlayersById.
 * (fetchAllPages()'s real >1000-row pagination boundary is exercised in queries-maps.test.ts via
 * getAllPlayedMatchIds()/getMatchIdsForMap(), which share the same helper — the fixture's
 * pagination filler lives on the `matches` table, not `player_match_stats`.)
 *
 * Run:  npx vitest run src/lib/queries-player.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestAdminClient } from './supabase-admin';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestAdminClient(createFakeSupabaseClient(buildFakeDb()));

import { getPlayer, getPlayerRecent, getPlayerSeasonAdrTotals, getPlayersById, getPlayerNameHistory, pickRecent, isPlayedHistoryRow } from './queries';
import { test, report } from './test-support/miniTest';

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

  await test('getPlayerRecent() — the pickRecent() rows of the full history, rosters included', async () => {
    for (const [id, limit] of [[1, 1], [1, 5], [7, 5]] as const) {
      const full = (await getPlayer(id))!.history;
      const recent = (await getPlayerRecent(id, limit))!;
      assert.deepEqual(recent.history, pickRecent(full, limit));
    }
    assert.equal(await getPlayerRecent(9999, 5), null);
  });

  await test('getPlayerNameHistory(2) — Bob has one prior rename', async () => {
    const history = await getPlayerNameHistory(2);
    assert.equal(history.length, 1);
    assert.equal(history[0].old_name, 'Robert');
    assert.equal(history[0].new_name, 'Bob');
    matchesSnapshot('getPlayerNameHistory-2', history);
  });

  await test('getPlayerNameHistory(1) — Alice has never renamed', async () => {
    assert.deepEqual(await getPlayerNameHistory(1), []);
  });

  await test('getPlayerSeasonAdrTotals() — one row per player per season over played matches with rounds, summing the history rows\' ADR', async () => {
    const totals = await getPlayerSeasonAdrTotals();
    for (const id of [1, 2, 7]) {
      const played = (await getPlayer(id))!.history.filter(isPlayedHistoryRow);
      const mine = totals.filter((t) => t.player_id === id);
      assert.equal(mine.reduce((n, t) => n + t.games, 0), played.length);
      assert.ok(Math.abs(mine.reduce((n, t) => n + t.adr_sum, 0) - played.reduce((n, r) => n + r.adr, 0)) < 1e-9);
      for (const t of mine) {
        const inSeason = played.filter((r) => r.season_id === t.season_id);
        assert.equal(t.games, inSeason.length);
        assert.equal(t.is_gauntlet, inSeason[0].is_gauntlet);
      }
    }
    matchesSnapshot('getPlayerSeasonAdrTotals', totals);
  });

  report();
}

await main();
