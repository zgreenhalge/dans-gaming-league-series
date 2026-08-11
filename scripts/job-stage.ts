// Shared job-lifecycle helper for the GitHub Actions job scripts (`demo-ingest.ts`,
// `replay-extract.ts`, `radar-build.ts`): the queued→running claim, per-stage progress reporting, and
// the top-level failure write every script's `main().catch(fail)` uses.
//
// Each named stage is reported two ways (issue #121): a collapsible GitHub Actions log group +
// `::notice::` annotation, and a `background_jobs.stage` write, so the admin dashboard can show
// progress without opening Actions. `currentStage` lets `fail()` report exactly where a run died,
// instead of a fixed catch-all string.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  jobStatusWriter,
  recordJobStatus,
  mirrorSubjectStatus,
  type JobKey,
  type JobSubject,
} from '../src/lib/background-jobs';
import { notice, error } from './gh-actions-log';

/** Normalizes a caught value into a loggable/DB-writable string — shared so `fail()` and a script's
 *  own wrapping `.catch()` (e.g. radar-build's GH-summary write, which needs the same message
 *  alongside its shared job-row write) derive it once rather than each re-deriving it from `err`. */
export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface JobRunner {
  /** The stage currently in flight, or the last one entered before a failure. */
  currentStage: string;
  /** The job row's bound writer (`jobStatusWriter`) — for a script's own non-lifecycle status writes
   *  (e.g. a terminal `succeeded`/`confirmed`/`parsed`) that `markRunning`/`fail`/`stage` don't cover. */
  setJob(fields: Record<string, unknown>): Promise<void>;
  /** Record `stage` on the job row without a log group — for a sub-step inside an already-wrapped
   *  stage (e.g. replay-extract's `parse-ticks`, folded into its `assemble` stage). */
  setStage(stage: string): Promise<void>;
  /** Run `fn` inside a collapsible GH log group, emitting a `::notice::` and recording the stage first. */
  stage<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
  /** Mark the row queued→running (idempotent), recording the GH run link and — if `subject` was
   *  passed to `createJobRunner` — mirroring `'running'` onto it. Throws if either write fails, so a
   *  script that can't even claim its own row aborts via `main().catch(...)` rather than proceeding
   *  unclaimed. */
  markRunning(): Promise<void>;
  /** The job script's top-level failure handler: logs `message` at `currentStage`, writes `failed` to
   *  the job row (+ mirrors onto `subject`, best-effort — this must not throw while already unwinding),
   *  and exits 1. `label` overrides the log line's leading tag (defaults to `jobType`) — pass a thunk
   *  when a more specific label resolves partway through the run (e.g. radar-build's map name). */
  fail(err: unknown): Promise<void>;
}

/**
 * `initial` should be the job's first stage, so `currentStage` reports something meaningful even if a
 * failure happens before the first `stage()`/`setStage()` call lands. Pass `subject` when this job
 * mirrors a coarse status onto a domain row (e.g. replay-extract's `matches.replay_status`) — the same
 * `JobSubject` shape `background-jobs.ts`'s own `dispatchAndRecordFailure` mirrors through, so a job
 * script's lifecycle writes can't disagree with a dispatch route's rollback write on what "mirror onto
 * the subject" means. Pass `label` for `fail()`'s log line when a more specific one than `jobType`
 * resolves partway through the run (a thunk, since it may not be known yet when `createJobRunner` is
 * called — e.g. radar-build resolves the map's name in its first stage).
 */
export function createJobRunner(
  admin: SupabaseClient,
  jobType: string,
  key: JobKey,
  initial: string,
  opts: { subject?: JobSubject; label?: () => string } = {},
): JobRunner {
  const ghRunId = process.env.GH_RUN_ID ? Number(process.env.GH_RUN_ID) : null;
  const ghRunUrl = process.env.GH_RUN_URL ?? null;
  const setJob = jobStatusWriter(admin, jobType, key);
  const label = opts.label ?? (() => jobType);

  const runner: JobRunner = {
    currentStage: initial,
    setJob,
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
    async markRunning() {
      // The job row and its mirrored subject are independent writes to different tables — run them
      // together rather than serially, the same shape `dispatchAndRecordFailure` (background-jobs.ts)
      // already uses for its own job-row + subject pair.
      const [, mirrorResult] = await Promise.all([
        setJob({
          status: 'running',
          stage: initial,
          error_message: null,
          gh_run_id: ghRunId,
          gh_run_url: ghRunUrl,
          started_at: new Date().toISOString(),
        }),
        opts.subject ? mirrorSubjectStatus(admin, opts.subject, 'running') : Promise.resolve<{ error?: string }>({}),
      ]);
      if (mirrorResult.error) throw new Error(mirrorResult.error);
    },
    async fail(err) {
      const message = formatError(err);
      error(`${label()} failed at stage ${runner.currentStage}: ${message}`);
      await Promise.all([
        recordJobStatus(admin, jobType, key, {
          status: 'failed',
          stage: runner.currentStage,
          error_message: message,
          finished_at: new Date().toISOString(),
        }),
        opts.subject ? mirrorSubjectStatus(admin, opts.subject, 'failed') : Promise.resolve<{ error?: string }>({}),
      ]);
      process.exit(1);
    },
  };
  return runner;
}
