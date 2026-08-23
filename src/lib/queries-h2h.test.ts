/**
 * Regression harness for queries.ts's H2H functions (#63) — getH2HData, and the four scorer
 * closures (duoBlendedScorer, rivalBlendedScorer, duoBreakdownScorer, rivalBreakdownScorer), which
 * are pure (no Supabase) but live in queries.ts and move in the #63 split — exercised here against
 * getH2HData()'s real output rather than hand-built DuoStats/H2HStats fixtures.
 *
 * Run:  npx vitest run src/lib/queries-h2h.test.ts
 */

import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';
import { test, report } from './test-support/miniTest';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import {
  getH2HData,
  duoBlendedScorer,
  rivalBlendedScorer,
  duoBreakdownScorer,
  rivalBreakdownScorer,
  computeDuoMaxes,
  computeRivalMaxes,
  friendsScore,
  rivalScore,
} from './queries';

async function main() {
  await test('getH2HData({filter: "career", includeRegular: true, includeGauntlet: true}) — snapshot', async () => {
    const data = await getH2HData({ filter: 'career', includeRegular: true, includeGauntlet: true });
    matchesSnapshot('getH2HData-career', data);
  });

  await test('getH2HData({filter: 1, includeRegular: true, includeGauntlet: false}) — single season, snapshot', async () => {
    matchesSnapshot('getH2HData-season1', await getH2HData({ filter: 1, includeRegular: true, includeGauntlet: false }));
  });

  await test('scorer closures applied to real H2H output, snapshot', async () => {
    const { duos, rivals } = await getH2HData({ filter: 'career', includeRegular: true, includeGauntlet: true });
    const duoScore = duoBlendedScorer(duos);
    const rivalBlended = rivalBlendedScorer(rivals);
    const duoBreakdown = duoBreakdownScorer(duos);
    const rivalBreakdown = rivalBreakdownScorer(rivals);

    matchesSnapshot('h2h-scorers', {
      duoScores: duos.map((d) => ({ pair: [d.playerA, d.playerB], score: duoScore(d), breakdown: duoBreakdown(d) })),
      rivalScores: rivals.map((r) => ({ pair: [r.playerA, r.playerB], score: rivalBlended(r), breakdown: rivalBreakdown(r) })),
    });
  });

  await test('friendsScore/rivalScore primitives agree with the closures over the same real duos/rivals', async () => {
    const { duos, rivals } = await getH2HData({ filter: 'career', includeRegular: true, includeGauntlet: true });
    const duoScore = duoBlendedScorer(duos);
    const rivalBlended = rivalBlendedScorer(rivals);
    const duoMaxes = computeDuoMaxes(duos);
    const rivalMaxes = computeRivalMaxes(rivals);

    for (const d of duos) {
      const primitive = friendsScore(d.gamesPlayed, d.wins, d.roundsWon, d.roundsPlayed, duoMaxes);
      if (Math.abs(primitive - duoScore(d)) > 1e-9) {
        throw new Error(`friendsScore diverged from duoBlendedScorer for pair [${d.playerA}, ${d.playerB}]`);
      }
    }
    for (const r of rivals) {
      const primitive = rivalScore(r.meetings, r.aWins, r.bWins, r.aStats.roundsWon, r.bStats.roundsWon, rivalMaxes);
      if (Math.abs(primitive - rivalBlended(r)) > 1e-9) {
        throw new Error(`rivalScore diverged from rivalBlendedScorer for pair [${r.playerA}, ${r.playerB}]`);
      }
    }
  });

  report();
}

await main();
