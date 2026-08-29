/**
 * Regression harness for queries/rounds.ts's getAllMatchRounds() — specifically its `ninja` field
 * (a defuse win with at least one T-side player still alive), derived via
 * deriveNinjaDefuseRounds() (queries/kills.ts) from match_kills + player_match_stats faction data
 * joined onto match_rounds. Exercises the fixture DB's match-100 rows (see fixtures.ts's
 * MATCH_ROUNDS/MATCH_KILLS comments for rounds 10/11's specific scenario).
 *
 * Run:  npx vitest run src/lib/queries-rounds.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getAllMatchRounds } from './queries';
import { test, report } from './test-support/miniTest';

async function main() {
  await test('getAllMatchRounds: a defuse win with one T-side player still alive is a ninja', async () => {
    const rounds = await getAllMatchRounds();
    const round10 = rounds.find((r) => r.match_id === 100 && r.round_number === 10);
    assert.equal(round10?.win_reason, 'defuse');
    assert.equal(round10?.ninja, true);
  });

  await test('getAllMatchRounds: a defuse win after a full T-side wipe is not a ninja', async () => {
    const rounds = await getAllMatchRounds();
    const round11 = rounds.find((r) => r.match_id === 100 && r.round_number === 11);
    assert.equal(round11?.win_reason, 'defuse');
    assert.equal(round11?.ninja, false);
  });

  await test('getAllMatchRounds: ninja is false for every non-defuse round', async () => {
    const rounds = await getAllMatchRounds();
    const round1 = rounds.find((r) => r.match_id === 100 && r.round_number === 1);
    assert.equal(round1?.win_reason, null);
    assert.equal(round1?.ninja, false);
  });

  report();
}

await main();
