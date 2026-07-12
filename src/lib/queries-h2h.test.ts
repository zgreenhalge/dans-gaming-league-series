/**
 * Regression harness for queries.ts's H2H functions (#63) — getH2HData, and the four scorer
 * closures (duoBlendedScorer, rivalBlendedScorer, duoBreakdownScorer, rivalBreakdownScorer), which
 * are pure (no Supabase) but live in queries.ts and move in the #63 split — exercised here against
 * getH2HData()'s real output rather than hand-built DuoStats/H2HStats fixtures.
 *
 * Run:  npx tsx src/lib/queries-h2h.test.ts
 */

import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import {
  getH2HData,
  duoBlendedScorer,
  rivalBlendedScorer,
  duoBreakdownScorer,
  rivalBreakdownScorer,
} from './queries';

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      passed++;
    } catch (err) {
      failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
    }
  })();
}

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
    const rivalScore = rivalBlendedScorer(rivals);
    const duoBreakdown = duoBreakdownScorer(duos);
    const rivalBreakdown = rivalBreakdownScorer(rivals);

    matchesSnapshot('h2h-scorers', {
      duoScores: duos.map((d) => ({ pair: [d.playerA, d.playerB], score: duoScore(d), breakdown: duoBreakdown(d) })),
      rivalScores: rivals.map((r) => ({ pair: [r.playerA, r.playerB], score: rivalScore(r), breakdown: rivalBreakdown(r) })),
    });
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('\nFailures:\n');
    for (const f of failures) console.error(`✗ ${f}\n`);
    process.exit(1);
  }
}

main();
