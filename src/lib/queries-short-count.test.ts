/**
 * Coverage for getShortCountHistory() — past archived regular seasons in which a player sat on the
 * short match count. Uses its own small db: season A (archived, uneven counts), season B (archived,
 * even counts), a gauntlet and an active season (both ignored).
 *
 * Run:  npx vitest run src/lib/queries-short-count.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestAdminClient } from './supabase-admin';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { test, report } from './test-support/miniTest';

const stat = (id: number, match_id: number, player_id: number) => ({ id, match_id, player_id, faction: 'SHIRTS' });

__setTestAdminClient(
  createFakeSupabaseClient({
    seasons: [
      { id: 1, name: 'Season 1', status: 'ARCHIVED', is_gauntlet: false },
      { id: 2, name: 'Season 2', status: 'ARCHIVED', is_gauntlet: false },
      { id: 3, name: 'Season 2 Gauntlet', status: 'ARCHIVED', is_gauntlet: true },
      { id: 4, name: 'Season 3', status: 'ACTIVE', is_gauntlet: false },
    ],
    weeks: [
      { id: 10, season_id: 1, week_number: 1 },
      { id: 20, season_id: 2, week_number: 1 },
      { id: 30, season_id: 3, week_number: 1 },
      { id: 40, season_id: 4, week_number: 1 },
    ],
    matches: [
      { id: 1, week_id: 10, match_number: 1, final_score: '13-9', is_playoff_game: false },
      { id: 2, week_id: 10, match_number: 2, final_score: '13-9', is_playoff_game: false },
      { id: 3, week_id: 20, match_number: 1, final_score: '13-9', is_playoff_game: false },
      { id: 4, week_id: 30, match_number: 1, final_score: '13-9', is_playoff_game: true },
      { id: 5, week_id: 40, match_number: 1, final_score: '13-9', is_playoff_game: false },
    ],
    // Season 1: players 1-3 play twice, player 4 once -> player 4 is short.
    // Season 2: everyone plays once -> nobody is short. Gauntlet/active seasons: ignored.
    player_match_stats: [
      stat(1, 1, 1), stat(2, 1, 2), stat(3, 1, 3), stat(4, 1, 4),
      stat(5, 2, 1), stat(6, 2, 2), stat(7, 2, 3),
      stat(8, 3, 1), stat(9, 3, 2), stat(10, 3, 3), stat(11, 3, 4),
      stat(12, 4, 1),
      stat(13, 5, 2),
    ],
    players: [],
  }),
);

import { getShortCountHistory } from './queries';

async function main() {
  await test('getShortCountHistory() — counts archived regular seasons on the short count only', async () => {
    const history = await getShortCountHistory([1, 2, 3, 4, 99]);
    assert.deepEqual(Object.fromEntries(history), { 1: 0, 2: 0, 3: 0, 4: 1, 99: 0 });
  });

  await test('getShortCountHistory([]) — empty map', async () => {
    assert.equal((await getShortCountHistory([])).size, 0);
  });

  report();
}

await main();
