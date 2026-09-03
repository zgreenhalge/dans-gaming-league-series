// Shared plumbing for the `background_jobs` state machine (see docs/replay.md's Schema section).
// Every dispatch route follows the same shape — claim a row, fire the GitHub Action, record success
// or failure — but differs in its guard (an in-flight SELECT, an atomic first-landing upsert, an
// auth check) and in which fields it claims with. Guards stay at the call site; this covers the
// identical tail every route shares: writing the row and, once claimed, dispatching and rolling back
// on failure.

import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchWorkflow } from './gh-dispatch';
import { JOB_IN_PROGRESS_STATUSES, isStale } from './jobs';

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

/**
 * Whether a `background_jobs` row for `(jobType, key)` is genuinely in flight — an in-progress
 * status with a recent enough `updated_at` heartbeat to trust, not one parked there by a run that
 * died without ever writing a terminal status (see `isStale()`/`STALE_IN_FLIGHT_MS` in `jobs.ts`).
 * Every dispatch route's duplicate-guard goes through this instead of a bare status check, so a
 * stuck job's own "reparse"/"retry" button is what un-wedges it rather than a silent no-op that
 * leaves the row wedged indefinitely.
 */
export async function isJobInFlight(admin: SupabaseClient, jobType: string, key: JobKey): Promise<boolean> {
  const { data } = await admin
    .from('background_jobs')
    .select('status, updated_at')
    .eq('job_type', jobType)
    .eq(key.column, key.id)
    .maybeSingle();
  const row = data as { status?: string; updated_at?: string | null } | null;
  if (!row?.status || !JOB_IN_PROGRESS_STATUSES.has(row.status)) return false;
  return !isStale(row.updated_at ?? null, Date.now());
}

/** `created_at` of a `background_jobs` row for `(jobType, key)`, or `null` if no such row exists yet.
 *  Every write path that touches an existing row (`recordJobStatus`, `advanceJobStatus`) only ever
 *  sets the columns it's given, so `created_at` — set once, at the row's first claim — survives every
 *  later retry/status update untouched. For a `job_type` that's claimed unconditionally at dispatch
 *  time (e.g. `demo_ingest`, claimed by `matchzy-log`'s handler the moment `map_result` fires,
 *  regardless of how any later run of that job is triggered), this is effectively "when the
 *  originating event happened," not just "when this particular run started." */
export async function getJobCreatedAt(admin: SupabaseClient, jobType: string, key: JobKey): Promise<Date | null> {
  const { data } = await admin
    .from('background_jobs')
    .select('created_at')
    .eq('job_type', jobType)
    .eq(key.column, key.id)
    .maybeSingle();
  const createdAt = (data as { created_at?: string } | null)?.created_at;
  return createdAt ? new Date(createdAt) : null;
}

/** Write `value` onto a `JobSubject`'s mirrored column — e.g. `matches.replay_status`. Exported for
 *  `scripts/job-stage.ts`'s `createJobRunner`, whose `markRunning`/`fail` mirror the same way this
 *  module's own `dispatchAndRecordFailure` does, so a job script's lifecycle writes and a dispatch
 *  route's rollback write can't disagree on what "mirror onto the subject" means. */
export async function mirrorSubjectStatus(
  admin: SupabaseClient,
  subject: JobSubject,
  value: string,
): Promise<{ error?: string }> {
  const { error } = await admin.from(subject.table).update({ [subject.column]: value }).eq('id', subject.id);
  return error ? { error: error.message } : {};
}

/** `mirrorSubjectStatus`, or a no-op resolving to `{}` when there's no subject to mirror — every
 *  caller that conditionally mirrors onto an optional `JobSubject` (this module's own
 *  `dispatchAndRecordFailure`, and `scripts/job-stage.ts`'s `createJobRunner`) shares this instead of
 *  each restating the same ternary. */
export function mirrorSubjectStatusOrNoop(
  admin: SupabaseClient,
  subject: JobSubject | undefined,
  value: string,
): Promise<{ error?: string }> {
  return subject ? mirrorSubjectStatus(admin, subject, value) : Promise.resolve({});
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

/** Update an existing `background_jobs` row — a no-op if none exists, never creating one (unlike
 *  `recordJobStatus`'s upsert). Pass `onlyIfStatus` when a dispatch response might land after the
 *  Action has already moved the row on (running/parsed/...) and shouldn't clobber it back to an
 *  earlier state; omit it when the caller means to overwrite whatever state the row is in — e.g.
 *  reconciling a job row to `confirmed` once a real score lands, regardless of whether that row was
 *  stuck at `failed` from a since-superseded run. */
export async function advanceJobStatus(
  admin: SupabaseClient,
  jobType: string,
  key: JobKey,
  fields: Record<string, unknown>,
  onlyIfStatus?: string,
): Promise<{ error?: string }> {
  let query = admin
    .from('background_jobs')
    .update({ updated_at: new Date().toISOString(), ...fields })
    .eq('job_type', jobType)
    .eq(key.column, key.id);
  if (onlyIfStatus !== undefined) query = query.eq('status', onlyIfStatus);
  const { error } = await query;
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
      mirrorSubjectStatusOrNoop(admin, params.subject, 'failed'),
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
