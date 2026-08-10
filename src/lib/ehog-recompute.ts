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

export interface TriggerRatingRecomputeOptions {
  /** Track this invocation as a `background_jobs` row (job_type `ehog_recompute`) alongside the
   *  existing `ops_errors` failure recording, so it shows up in AdminActivityFeed the same way the
   *  other three pipelines do. Pass the triggering match's key from `writeMatchScore` — every
   *  auto-triggered recompute rides along a score write, so a match key is always available there.
   *  Omitted by the admin "recompute now" control, which has no single match to key a row against. */
  jobKey?: JobKey;
}

/** There's no per-match or per-season entity a recompute failure belongs to — it's a single
 * site-wide history walk — so it's recorded against the `system` entity type's singleton id. */
export async function triggerRatingRecompute(
  supabaseAdmin: SupabaseClient,
  opts: TriggerRatingRecomputeOptions = {},
): Promise<void> {
  const { jobKey } = opts;
  // Record a background_jobs status transition — a no-op when no jobKey is given (the admin-triggered
  // manual recompute has no per-match key to record against). Callers fire this alongside the
  // ops_errors write it pairs with via Promise.all, rather than serializing two independent writes.
  const track = (fn: typeof recordJobStatus, fields: Record<string, unknown>): Promise<unknown> =>
    jobKey ? fn(supabaseAdmin, EHOG_RECOMPUTE_JOB_TYPE, jobKey, fields) : Promise.resolve();

  const secret = process.env.RECOMPUTE_SECRET;
  if (!secret) {
    // A silent no-op here is indistinguishable from a healthy system with nothing to do — this
    // config gap can otherwise go unnoticed across every score write in an environment (e.g. the
    // demo-ingest Action) that never had RECOMPUTE_SECRET set, surfacing only as a leaderboard that
    // silently stops updating. Recorded, not thrown, since a missing secret shouldn't fail the score
    // write that triggered this call.
    await Promise.all([
      recordOpsError(
        supabaseAdmin,
        'system',
        0,
        'ehog_recompute',
        'EHOG recompute skipped: RECOMPUTE_SECRET is not set in this environment',
      ),
      track(recordJobStatus, {
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
    const [res] = await Promise.all([
      fetch(`${base}/api/ehog/recompute`, {
        method: 'POST',
        headers: { 'x-recompute-secret': secret },
      }),
      track(recordJobStatus, {
        status: 'running',
        stage: 'recompute',
        error_message: null,
        started_at: new Date().toISOString(),
        finished_at: null,
      }),
    ]);
    if (!res.ok) throw new Error(`recompute endpoint responded ${res.status}`);
    await Promise.all([
      clearOpsError(supabaseAdmin, 'system', 0, 'ehog_recompute'),
      track(advanceJobStatus, {
        status: 'succeeded',
        stage: 'done',
        error_message: null,
        finished_at: new Date().toISOString(),
      }),
    ]);
  } catch (e) {
    console.error('EHOG recompute trigger failed:', e);
    await Promise.all([
      recordOpsError(supabaseAdmin, 'system', 0, 'ehog_recompute', `EHOG recompute failed: ${(e as Error).message}`),
      track(advanceJobStatus, {
        status: 'failed',
        error_message: `EHOG recompute failed: ${(e as Error).message}`,
        finished_at: new Date().toISOString(),
      }),
    ]);
  }
}
