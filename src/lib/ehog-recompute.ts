// Fire the EHOG rating recompute (Python function at `api/ehog/recompute.py`). Holds the
// `RECOMPUTE_SECRET` server-side, so only server code can trigger a full history walk. Best-effort;
// in a request handler, callers wrap the call in `after()` so it never blocks the response — the
// demo-ingest Action (no request scope) awaits it directly instead.
//
// Callers: `writeMatchScore` (`src/lib/matchScore.ts`, shared by the interactive score route and the
// demo-ingest Action's auto-commit) and the admin "recompute now" control
// (`src/app/api/ehog/recompute/trigger/route.ts`).

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordOpsError, clearOpsError } from './ops-errors';
import { recordJobStatus, advanceJobStatus, type JobKey } from './background-jobs';
import { EHOG_RECOMPUTE_JOB_TYPE } from './jobs';

/** Collaborators `triggerRatingRecompute` calls through — defaults to the real fetch and
 *  background-jobs/ops-errors writers; a test injects fakes to assert write ordering without a live
 *  Supabase client or network call. */
interface RecomputeDeps {
  fetch: typeof fetch;
  recordOpsError: typeof recordOpsError;
  clearOpsError: typeof clearOpsError;
  recordJobStatus: typeof recordJobStatus;
  advanceJobStatus: typeof advanceJobStatus;
}

const REAL_DEPS: RecomputeDeps = { fetch, recordOpsError, clearOpsError, recordJobStatus, advanceJobStatus };

export interface TriggerRatingRecomputeOptions {
  /** Track this invocation as a `background_jobs` row (job_type `ehog_recompute`) alongside the
   *  existing `ops_errors` failure recording, so it shows up in AdminActivityFeed the same way the
   *  other three pipelines do. Pass the triggering match's key from `writeMatchScore` — every
   *  auto-triggered recompute rides along a score write, so a match key is always available there.
   *  Omitted by the admin "recompute now" control, which has no single match to key a row against. */
  jobKey?: JobKey;
  deps?: RecomputeDeps;
}

/** There's no per-match or per-season entity a recompute failure belongs to — it's a single
 * site-wide history walk — so it's recorded against the `system` entity type's singleton id. */
export async function triggerRatingRecompute(
  supabaseAdmin: SupabaseClient,
  opts: TriggerRatingRecomputeOptions = {},
): Promise<void> {
  const { jobKey } = opts;
  const deps = opts.deps ?? REAL_DEPS;
  // Record a background_jobs status transition — a no-op when no jobKey is given (the admin-triggered
  // manual recompute has no per-match key to record against). Logs (doesn't throw) on its own write
  // failure, mirroring dispatchAndRecordFailure's convention in background-jobs.ts.
  const track = async (fn: typeof deps.recordJobStatus, fields: Record<string, unknown>): Promise<void> => {
    if (!jobKey) return;
    const { error } = await fn(supabaseAdmin, EHOG_RECOMPUTE_JOB_TYPE, jobKey, fields);
    if (error) console.error(`ehog_recompute job-status write failed (${jobKey.column}=${jobKey.id}):`, error);
  };

  const secret = process.env.RECOMPUTE_SECRET;
  if (!secret) {
    // A silent no-op here is indistinguishable from a healthy system with nothing to do — this
    // config gap can otherwise go unnoticed across every score write in an environment (e.g. the
    // demo-ingest Action) that never had RECOMPUTE_SECRET set, surfacing only as a leaderboard that
    // silently stops updating. Recorded, not thrown, since a missing secret shouldn't fail the score
    // write that triggered this call.
    await Promise.all([
      deps.recordOpsError(
        supabaseAdmin,
        'system',
        0,
        'ehog_recompute',
        'EHOG recompute skipped: RECOMPUTE_SECRET is not set in this environment',
      ),
      track(deps.recordJobStatus, {
        status: 'failed',
        stage: 'skipped',
        error_message: 'RECOMPUTE_SECRET is not set in this environment',
        finished_at: new Date().toISOString(),
      }),
    ]);
    return;
  }
  // APP_BASE_URL covers the demo-ingest Action, which runs outside Vercel and has no VERCEL_URL. Uses
  // `||`, not `??`: a GitHub Actions repo variable that isn't set still substitutes as an empty
  // string (`${{ vars.APP_BASE_URL }}`), never `undefined`, so `??` alone would leave `base` empty and
  // turn the fetch below into a relative-URL parse error instead of falling through.
  const base =
    process.env.APP_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  try {
    // Written and awaited *before* the fetch, not alongside it: advanceJobStatus('failed') in the
    // catch below must never race an in-flight recordJobStatus('running') upsert. Promise.all would
    // reject the instant fetch rejects without waiting for that upsert to settle, leaving it to land
    // later and silently overwrite the failure back to "running" forever.
    await track(deps.recordJobStatus, {
      status: 'running',
      stage: 'recompute',
      error_message: null,
      started_at: new Date().toISOString(),
      finished_at: null,
    });
    const res = await deps.fetch(`${base}/api/ehog/recompute`, {
      method: 'POST',
      headers: { 'x-recompute-secret': secret },
    });
    if (!res.ok) throw new Error(`recompute endpoint responded ${res.status}`);
    await Promise.all([
      deps.clearOpsError(supabaseAdmin, 'system', 0, 'ehog_recompute'),
      track(deps.advanceJobStatus, {
        status: 'succeeded',
        stage: 'done',
        error_message: null,
        finished_at: new Date().toISOString(),
      }),
    ]);
  } catch (e) {
    console.error('EHOG recompute trigger failed:', e);
    await Promise.all([
      deps.recordOpsError(supabaseAdmin, 'system', 0, 'ehog_recompute', `EHOG recompute failed: ${(e as Error).message}`),
      track(deps.advanceJobStatus, {
        status: 'failed',
        error_message: `EHOG recompute failed: ${(e as Error).message}`,
        finished_at: new Date().toISOString(),
      }),
    ]);
  }
}
