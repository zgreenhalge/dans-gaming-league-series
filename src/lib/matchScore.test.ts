/**
 * Regression harness for matchScore.ts's gauntlet-completion pipeline (#334) — asserts
 * runGauntletCompletionPipeline always finishes propagation before starting the completion check,
 * since checking completion first can see an incomplete round as "everything played" and archive a
 * gauntlet season early (see docs/architecture.md).
 *
 * Run:  npx tsx src/lib/matchScore.test.ts
 */

import assert from 'node:assert/strict';
import { runGauntletCompletionPipeline } from './matchScore';
import { test, report } from './test-support/miniTest';

async function main() {
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

main();
