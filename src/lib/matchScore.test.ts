/**
 * Regression harness for matchScore.ts: the gauntlet-completion pipeline (#334) — asserts
 * runGauntletCompletionPipeline always finishes propagation before starting the completion check,
 * since checking completion first can see an incomplete round as "everything played" and archive a
 * gauntlet season early (see docs/architecture.md) — and writeMatchScore(): a scrim match, which
 * writes the score but runs none of the league hooks, and a 0-0 result, which it refuses.
 *
 * Run:  npx vitest run src/lib/matchScore.test.ts
 */

import assert from 'node:assert/strict';
import { runGauntletCompletionPipeline, writeMatchScore } from './matchScore';
import { test, report } from './test-support/miniTest';
import { __setTestAdminClient } from './supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from './test-support/fakeSupabase';

/** One scrim match (900) and one league match (100), each a 2v2 with zeroed stat rows. */
function scoringDb(): FakeDb {
  const stats = (matchId: number, base: number) =>
    [1, 2, 3, 4].map((p, i) => ({
      id: base + i, match_id: matchId, player_id: p, faction: i < 2 ? 'SHIRTS' : 'SKINS',
      kills: 0, assists: 0, deaths: 0, adr: 0, damage: 0, rounds_played: 0, rounds_won: 0, is_win: false,
    }));
  return {
    seasons: [{ id: 1, name: 'Season 5', status: 'ACTIVE', is_gauntlet: false }],
    weeks: [{ id: 10, season_id: 1, week_number: 1 }],
    matches: [
      { id: 100, week_id: 10, scrim_night_id: null, match_number: 1, final_score: null, is_playoff_game: false },
      { id: 900, week_id: null, scrim_night_id: 5, match_number: 1, final_score: null, is_playoff_game: false },
    ],
    player_match_stats: [...stats(100, 1000), ...stats(900, 9000)],
    background_jobs: [],
    ops_errors: [],
  };
}

function scoreInput() {
  return {
    shirts: 13,
    skins: 7,
    player_stats: [1, 2, 3, 4].map((player_id) => ({ player_id, kills: 10, assists: 2, deaths: 8, damage: 1500 })),
  };
}

async function main() {
  await test('writeMatchScore — a scrim match is scored without queueing a rating recompute', async () => {
    const db = scoringDb();
    const client = createFakeSupabaseClient(db);
    __setTestAdminClient(client);
    const result = await writeMatchScore(client as never, 900, scoreInput());
    assert.deepEqual(result, { ok: true });
    assert.equal(db.matches.find((m) => m.id === 900)!.final_score, '13-7');
    const winner = db.player_match_stats.find((r) => r.match_id === 900 && r.player_id === 1)!;
    assert.equal(winner.is_win, true);
    assert.equal(winner.kills, 10);
    assert.ok(!db.background_jobs.some((j) => j.job_type === 'ehog_recompute'), 'no ehog_recompute job for a scrim');
  });

  await test('writeMatchScore — control: a league match does queue the rating recompute', async () => {
    const db = scoringDb();
    const client = createFakeSupabaseClient(db);
    __setTestAdminClient(client);
    assert.deepEqual(await writeMatchScore(client as never, 100, scoreInput()), { ok: true });
    assert.ok(db.background_jobs.some((j) => j.job_type === 'ehog_recompute'), 'ehog_recompute job for a league match');
  });

  await test('writeMatchScore — a 0-0 result is rejected and the match stays unplayed', async () => {
    const db = scoringDb();
    const client = createFakeSupabaseClient(db);
    __setTestAdminClient(client);
    const result = await writeMatchScore(client as never, 100, { ...scoreInput(), shirts: 0, skins: 0 });
    assert.deepEqual(result, { ok: false, error: 'A played match has at least one round', status: 400 });
    assert.equal(db.matches.find((m) => m.id === 100)!.final_score, null);
  });

  await test('runGauntletCompletionPipeline — propagation completes before the completion check starts', async () => {
    const calls: string[] = [];
    await runGauntletCompletionPipeline(null as never, 100, 5, {
      resolveAndPropagate: async () => {
        // A macrotask delay: if the pipeline ever ran these two steps concurrently instead of in
        // sequence, checkGauntletCompletion's synchronous push below would land first.
        await new Promise((resolve) => setTimeout(resolve, 10));
        calls.push('propagate');
      },
      checkGauntletCompletion: async () => {
        calls.push('checkCompletion');
      },
    });
    assert.deepEqual(calls, ['propagate', 'checkCompletion']);
  });

  await test('runGauntletCompletionPipeline — completion check still runs when propagation throws', async () => {
    const calls: string[] = [];
    await runGauntletCompletionPipeline(null as never, 100, 5, {
      resolveAndPropagate: async () => {
        calls.push('propagate');
        throw new Error('propagate failed');
      },
      checkGauntletCompletion: async () => {
        calls.push('checkCompletion');
      },
    });
    assert.deepEqual(calls, ['propagate', 'checkCompletion']);
  });

  await test('runGauntletCompletionPipeline — a completion-check failure does not throw out of the pipeline', async () => {
    await runGauntletCompletionPipeline(null as never, 100, 5, {
      resolveAndPropagate: async () => {},
      checkGauntletCompletion: async () => {
        throw new Error('completion check failed');
      },
    });
  });

  report();
}

await main();

__setTestAdminClient(undefined);
