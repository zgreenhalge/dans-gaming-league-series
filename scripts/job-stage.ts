// Shared stage-tracking helper for job scripts (`demo-ingest.ts`, `replay-extract.ts`,
// `radar-build.ts`). Each named
// stage is reported two ways (issue #121): a collapsible GitHub Actions log group + `::notice::`
// annotation, and a `background_jobs.stage` write, so the admin dashboard can show progress without
// opening Actions. `currentStage` lets a script's top-level `fail()` report exactly where a run died,
// instead of a fixed catch-all string.

import { notice } from './gh-actions-log';

export interface StageRunner {
  /** The stage currently in flight, or the last one entered before a failure. */
  currentStage: string;
  /** Record `stage` on the job row without a log group — for a sub-step inside an already-wrapped
   *  stage (e.g. replay-extract's `parse-ticks`, folded into its `assemble` stage). */
  setStage(stage: string): Promise<void>;
  /** Run `fn` inside a collapsible GH log group, emitting a `::notice::` and recording the stage first. */
  stage<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
}

/** `initial` should be the job's first stage, so `currentStage` reports something meaningful even if
 *  a failure happens before the first `stage()`/`setStage()` call lands. `setJob` is the script's
 *  bound `jobStatusWriter` — this only ever writes `{ stage }`, never `status`. */
export function createStageRunner(
  initial: string,
  setJob: (fields: Record<string, unknown>) => Promise<void>,
): StageRunner {
  const runner: StageRunner = {
    currentStage: initial,
    async setStage(name) {
      runner.currentStage = name;
      await setJob({ stage: name });
    },
    async stage(name, fn) {
      console.log(`::group::${name}`);
      notice(`stage ${name}`);
      await runner.setStage(name);
      try {
        return await fn();
      } finally {
        console.log('::endgroup::');
      }
    },
  };
  return runner;
}
