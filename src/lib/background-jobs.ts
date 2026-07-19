// Shared plumbing for the `background_jobs` state machine (see docs/replay.md's Schema section).
// Every dispatch route follows the same shape — claim a row, fire the GitHub Action, record success
// or failure — but differs in its guard (an in-flight SELECT, an atomic first-landing upsert, an
// auth check) and in which fields it claims with. Guards stay at the call site; this covers the
// identical tail every route shares: writing the row and, once claimed, dispatching and rolling back
// on failure.

import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchWorkflow } from './gh-dispatch';

/** A denormalized status column mirroring a `background_jobs` row for cheap reads elsewhere (e.g.
 *  `matches.replay_status`), kept in sync alongside the job row. */
export interface JobSubject {
  table: string;
  column: string;
  id: number;
}

async function mirrorSubjectStatus(admin: SupabaseClient, subject: JobSubject, value: string) {
  await admin.from(subject.table).update({ [subject.column]: value }).eq('id', subject.id);
}

/** Upsert a `background_jobs` row for `(jobType, matchId)`, stamping `updated_at`. `onConflict` is
 *  always `job_type,match_id` — the unique index that is this pipeline's dedup guard. */
export async function recordJobStatus(
  admin: SupabaseClient,
  jobType: string,
  matchId: number,
  fields: Record<string, unknown>,
): Promise<{ error?: string }> {
  const { error } = await admin.from('background_jobs').upsert(
    { job_type: jobType, match_id: matchId, updated_at: new Date().toISOString(), ...fields },
    { onConflict: 'job_type,match_id' },
  );
  return error ? { error: error.message } : {};
}

/** Advance a `background_jobs` row only if it's still in `onlyIfStatus` — so a dispatch response
 *  that lands after the Action has already moved the row on (running/parsed/...) doesn't clobber it
 *  back to an earlier state. */
export async function advanceJobStatus(
  admin: SupabaseClient,
  jobType: string,
  matchId: number,
  fields: Record<string, unknown>,
  onlyIfStatus: string,
): Promise<void> {
  await admin
    .from('background_jobs')
    .update({ updated_at: new Date().toISOString(), ...fields })
    .eq('job_type', jobType)
    .eq('match_id', matchId)
    .eq('status', onlyIfStatus);
}

/**
 * Dispatch the workflow for an already-claimed job. On failure, rolls the job row (and its mirrored
 * `subject` column, if given) back to `failed` with the dispatch error — so a transient dispatch
 * failure never leaves the match wedged in `queued` behind an in-flight guard. On success, the row
 * claimed before calling this is left as-is: every call site claims with the terminal "dispatched"
 * status already set.
 */
export async function dispatchAndRecordFailure(
  admin: SupabaseClient,
  params: {
    jobType: string;
    matchId: number;
    workflowFile: string;
    inputs: Record<string, string>;
    subject?: JobSubject;
  },
): Promise<{ ok: boolean; error?: string }> {
  const dispatch = await dispatchWorkflow(params.workflowFile, params.inputs);
  if (!dispatch.ok) {
    await recordJobStatus(admin, params.jobType, params.matchId, {
      status: 'failed',
      error_message: `dispatch failed: ${dispatch.error}`,
    });
    if (params.subject) await mirrorSubjectStatus(admin, params.subject, 'failed');
  }
  return dispatch;
}
