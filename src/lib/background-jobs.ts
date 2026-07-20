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

/** The row-key column identifying a `background_jobs` row alongside `job_type` — `match_id` for the
 *  match-keyed dispatch routes (replay/demo/ingest), `map_id` for the map-keyed radar dispatch. */
export interface JobKey {
  column: 'match_id' | 'map_id';
  id: number;
}

export const matchJobKey = (id: number): JobKey => ({ column: 'match_id', id });
export const mapJobKey = (id: number): JobKey => ({ column: 'map_id', id });

async function mirrorSubjectStatus(
  admin: SupabaseClient,
  subject: JobSubject,
  value: string,
): Promise<{ error?: string }> {
  const { error } = await admin.from(subject.table).update({ [subject.column]: value }).eq('id', subject.id);
  return error ? { error: error.message } : {};
}

/** Upsert a `background_jobs` row for `(jobType, key)`, stamping `updated_at`. `onConflict` is
 *  always `job_type,<key.column>` — the unique index that is this pipeline's dedup guard. */
export async function recordJobStatus(
  admin: SupabaseClient,
  jobType: string,
  key: JobKey,
  fields: Record<string, unknown>,
): Promise<{ error?: string }> {
  const { error } = await admin.from('background_jobs').upsert(
    { job_type: jobType, [key.column]: key.id, updated_at: new Date().toISOString(), ...fields },
    { onConflict: `job_type,${key.column}` },
  );
  return error ? { error: error.message } : {};
}

/** Bind `recordJobStatus` to a fixed `(jobType, key)`, throwing if the write fails — for a GitHub
 *  Actions job script's per-stage writes, where a corrupted status row should abort the run (via the
 *  script's own top-level `catch`) rather than continue past it silently. */
export function jobStatusWriter(
  admin: SupabaseClient,
  jobType: string,
  key: JobKey,
): (fields: Record<string, unknown>) => Promise<void> {
  return async (fields) => {
    const { error } = await recordJobStatus(admin, jobType, key, fields);
    if (error) throw new Error(error);
  };
}

/** Advance a `background_jobs` row only if it's still in `onlyIfStatus` — so a dispatch response
 *  that lands after the Action has already moved the row on (running/parsed/...) doesn't clobber it
 *  back to an earlier state. */
export async function advanceJobStatus(
  admin: SupabaseClient,
  jobType: string,
  key: JobKey,
  fields: Record<string, unknown>,
  onlyIfStatus: string,
): Promise<{ error?: string }> {
  const { error } = await admin
    .from('background_jobs')
    .update({ updated_at: new Date().toISOString(), ...fields })
    .eq('job_type', jobType)
    .eq(key.column, key.id)
    .eq('status', onlyIfStatus);
  return error ? { error: error.message } : {};
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
    key: JobKey;
    workflowFile: string;
    inputs: Record<string, string>;
    subject?: JobSubject;
  },
): Promise<{ ok: boolean; error?: string }> {
  const dispatch = await dispatchWorkflow(params.workflowFile, params.inputs);
  if (!dispatch.ok) {
    const [jobResult, subjectResult] = await Promise.all([
      recordJobStatus(admin, params.jobType, params.key, {
        status: 'failed',
        error_message: `dispatch failed: ${dispatch.error}`,
      }),
      params.subject ? mirrorSubjectStatus(admin, params.subject, 'failed') : Promise.resolve<{ error?: string }>({}),
    ]);
    if (jobResult.error) {
      console.error(`Could not roll back ${params.jobType}/${params.key.id} to failed: ${jobResult.error}`);
    }
    if (subjectResult.error) {
      console.error(
        `Could not mirror failed status onto ${params.subject?.table}.${params.subject?.column} for ${params.key.id}: ${subjectResult.error}`,
      );
    }
  }
  return dispatch;
}
