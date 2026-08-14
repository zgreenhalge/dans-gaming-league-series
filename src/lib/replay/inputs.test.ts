/**
 * Unit tests for `getReplayInputs()` — resolves `buildReplay()`'s DB inputs (map, starting side,
 * target rounds, roster, gauntlet flag, scheduled date) for a match, shared by the in-app dispatch
 * path and the `replay-extract` Action. Against `fakeSupabase.ts`, exercising the
 * `matches -> weeks -> seasons` embed chain and the `shirts_pick`/`picked_map` map fallback.
 *
 * Run:  npx vitest run src/lib/replay/inputs.test.ts
 */

import assert from 'node:assert/strict';
import { getReplayInputs } from './inputs';
import { createFakeSupabaseClient, type FakeDb } from '../test-support/fakeSupabase';
import { test, report } from '../test-support/miniTest';

function buildDb(): FakeDb {
  return {
    seasons: [
      { id: 1, target_win_rounds: 13, is_gauntlet: false },
      { id: 2, target_win_rounds: 16, is_gauntlet: true },
    ],
    weeks: [
      { id: 10, season_id: 1 },
      { id: 11, season_id: 2 },
    ],
    matches: [
      {
        id: 100, week_id: 10, shirts_pick: 'Foroglio', picked_map: 'Foroglio',
        skins_starting_side: 'CT', scheduled_at: '2026-01-15T19:00:00.000Z',
      },
      {
        // No shirts_pick yet (unveto'd) — falls back to picked_map.
        id: 101, week_id: 10, shirts_pick: null, picked_map: 'Vertigo',
        skins_starting_side: null, scheduled_at: null,
      },
      {
        id: 200, week_id: 11, shirts_pick: 'Cobblestone', picked_map: 'Cobblestone',
        skins_starting_side: 'T', scheduled_at: '2026-03-01T00:00:00.000Z',
      },
    ],
    player_match_stats: [
      { match_id: 100, player_id: 1, faction: 'SHIRTS' },
      { match_id: 100, player_id: 2, faction: 'SKINS' },
      { match_id: 200, player_id: 1, faction: 'SHIRTS' },
    ],
    players: [
      { id: 1, name: 'Alice', steam_id: '76500000000000001', steam_nickname: 'alice_cs' },
      // Player 2 has no players row (deleted/unlinked) — roster falls back to a placeholder name.
    ],
  };
}

// getReplayInputs() only reads (no insert/update/delete), so a single fake client is safe to
// share across every test below — no cross-test mutation to isolate against.
const supabase = createFakeSupabaseClient(buildDb());

async function main() {
  await test('getReplayInputs: resolves map, side, target rounds, gauntlet flag, and roster for a regular match', async () => {
    const inputs = await getReplayInputs(supabase, 100);
    assert.equal(inputs.map, 'Foroglio');
    assert.equal(inputs.skinsSide, 'CT');
    assert.equal(inputs.targetWinRounds, 13);
    assert.equal(inputs.isGauntlet, false);
    assert.equal(inputs.scheduledAt, '2026-01-15T19:00:00.000Z');
    assert.equal(inputs.roster.length, 2);
    const alice = inputs.roster.find((r) => r.player_id === 1)!;
    assert.equal(alice.faction, 'SHIRTS');
    assert.equal(alice.steam_id, '76500000000000001');
    assert.equal(alice.name, 'Alice');
  });

  await test('getReplayInputs: falls back to picked_map when shirts_pick is not yet set', async () => {
    const inputs = await getReplayInputs(supabase, 101);
    assert.equal(inputs.map, 'Vertigo');
  });

  await test('getReplayInputs: reads target rounds and the gauntlet flag off the paired season', async () => {
    const inputs = await getReplayInputs(supabase, 200);
    assert.equal(inputs.targetWinRounds, 16);
    assert.equal(inputs.isGauntlet, true);
    assert.equal(inputs.skinsSide, 'T');
  });

  await test('getReplayInputs: a roster player missing its own players row gets a placeholder name and null steam fields', async () => {
    const inputs = await getReplayInputs(supabase, 100);
    const bob = inputs.roster.find((r) => r.player_id === 2)!;
    assert.equal(bob.name, '#2');
    assert.equal(bob.steam_id, null);
    assert.equal(bob.steam_nickname, null);
  });

  await test('getReplayInputs: throws for a match that does not exist', async () => {
    await assert.rejects(() => getReplayInputs(supabase, 9999), /not found/);
  });

  report();
}

await main();
