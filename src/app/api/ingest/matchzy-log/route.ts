// Machine-authenticated MatchZy remote-log receiver — the `matchzy_remote_log_url` target (#138).
// MatchZy POSTs every match event here (going_live, round_end, map_result, …); `map_result`'s full
// payload is kept as the independent cross-check trusted auto-commit uses to corroborate the
// demo-derived score, and it's also this pipeline's trigger: DGLS is BO1, so `map_result` (a map
// ending) and the series ending are simultaneous — MatchZy's own `HandleMatchEnd` fires both the
// map-end and match-end handling in the same call when `NumMaps: 1`. There is no separate "the match
// is truly over" signal to wait for. Every event still updates the last-contact marker
// (`matchzyContact.ts`) before being otherwise dropped, so "did the server ever talk to us for this
// match" stays answerable after the fact. `going_live`/`round_end`/`map_result` all feed the live-score
// table (`liveScore.ts`) through the same generic path. Small JSON body — no Worker needed (unlike the
// demo, which is pulled rather than pushed — see `fetchFromDathost.ts`).
//
// Auth: shared secret in `x-matchzy-token`, constant-time compared against `INGEST_REMOTE_LOG_SECRET`.

import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { machineSecretGuard } from '@/lib/machine-auth';
import { getAdminClient } from '@/lib/supabase-admin';
import { parseMapResultEvent, putMapResult } from '@/lib/demo/mapResult';
import { parseMatchzyEventIdentity, putMatchzyContact } from '@/lib/demo/matchzyContact';
import { putLiveScoreEvent } from '@/lib/demo/liveScore';
import { dispatchWorkflow } from '@/lib/gh-dispatch';
import { advanceJobStatus, dispatchAndRecordFailure, matchJobKey } from '@/lib/background-jobs';
import { teardownMatchServer } from '@/lib/dathost-lifecycle';
import { recordOpsError, clearOpsError } from '@/lib/ops-errors';
import { DEMO_INGEST_JOB_TYPE } from '@/lib/demo/ingestResult';
import { REPLAY_EXTRACT_JOB_TYPE } from '@/lib/jobs';
import { afterBestEffort } from '@/lib/after';

/** Claims the demo-ingest job atomically before dispatching — a plain check-then-act (SELECT to see
 *  if a job's already in flight, then upsert) can't tell two concurrent map_result deliveries for the
 *  same match (e.g. a MatchZy retry racing the original) apart: both would pass the check and both
 *  dispatch. `ignoreDuplicates` makes the claim itself the check — the INSERT only lands if no row
 *  exists yet for `(job_type, match_id)`, so exactly one caller ever sees a non-empty `claimed`. */
async function dispatchDemoIngest(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('background_jobs')
    .upsert(
      {
        job_type: DEMO_INGEST_JOB_TYPE,
        match_id: matchId,
        status: 'received',
        stage: 'received',
        error_message: null,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'job_type,match_id', ignoreDuplicates: true },
    )
    .select('match_id');
  if (claimErr) {
    console.error(`matchzy-log: could not claim demo-ingest job for match ${matchId}: ${claimErr.message}`);
    return;
  }
  if (!claimed || claimed.length === 0) return; // already claimed — in flight, or already ran once

  const dispatch = await dispatchWorkflow('demo-ingest.yml', { match_id: String(matchId) });
  if (dispatch.ok) {
    const { error: advanceErr } = await advanceJobStatus(
      supabaseAdmin,
      DEMO_INGEST_JOB_TYPE,
      matchJobKey(matchId),
      { status: 'queued', stage: 'queued' },
      'received',
    );
    if (advanceErr) {
      console.error(`matchzy-log: could not advance demo-ingest job for match ${matchId} to queued: ${advanceErr}`);
    }
  } else {
    console.error(`matchzy-log: demo-ingest dispatch failed for match ${matchId}: ${dispatch.error}`);
  }
}

/** Same shadow-first opt-in as demo-ingest's AUTO_COMMIT_ENABLED — watched before going live. Guards
 *  itself (the claim upsert), independent of whether demo-ingest's own dispatch above ran. */
async function dispatchReplayExtractIfEnabled(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  if (process.env.REPLAY_AUTO_DISPATCH !== 'true') return;

  const now = new Date().toISOString();
  const { data: claimed } = await supabaseAdmin
    .from('background_jobs')
    .upsert(
      {
        job_type: REPLAY_EXTRACT_JOB_TYPE,
        match_id: matchId,
        status: 'queued',
        stage: 'validate',
        error_message: null,
        created_at: now,
        updated_at: now,
      },
      { onConflict: 'job_type,match_id', ignoreDuplicates: true },
    )
    .select('match_id');
  if (!claimed || claimed.length === 0) return;

  await supabaseAdmin.from('matches').update({ replay_status: 'queued' }).eq('id', matchId);
  const replayDispatch = await dispatchAndRecordFailure(supabaseAdmin, {
    jobType: REPLAY_EXTRACT_JOB_TYPE,
    key: matchJobKey(matchId),
    workflowFile: 'replay-extract.yml',
    inputs: { match_id: String(matchId) },
    subject: { table: 'matches', column: 'replay_status', id: matchId },
  });
  if (!replayDispatch.ok) {
    console.error(`matchzy-log: replay-extract auto-dispatch failed for match ${matchId}: ${replayDispatch.error}`);
  }
}

/** The map ending means the match is over → tear down the shared server now, without waiting for the
 *  score write (#135). Best-effort, skipped when hosting isn't configured; `onlyIfOwnsServer` so a
 *  map_result for one match never stops another match's live server. Score-write teardown remains the
 *  fallback. */
async function teardownAfterMatchEnd(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  if (!process.env.DATHOST_SERVER_ID) return;
  try {
    await teardownMatchServer(supabaseAdmin, matchId, { onlyIfOwnsServer: true });
    await clearOpsError(supabaseAdmin, 'match', matchId, 'server_teardown');
  } catch (err) {
    console.error(`matchzy-log: auto-teardown(${matchId}) failed:`, err);
    await recordOpsError(supabaseAdmin, 'match', matchId, 'server_teardown', `Server teardown failed: ${(err as Error).message}`);
  }
}

/**
 * Kick off the demo-ingest (and, opt-in, replay-extract) pipeline for a match that just ended, and
 * tear down its server. `map_result` is the trigger rather than the demo's arrival in R2 — the demo is
 * pulled by the Action itself (`fetchFromDathost.ts`), not pushed, so its arrival can't gate this.
 * The three concerns are independent of each other (different job rows / different DatHost resource,
 * each guards its own dedup), so they run concurrently rather than one waiting behind the others.
 */
async function triggerDemoPipeline(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  await Promise.allSettled([
    dispatchDemoIngest(supabaseAdmin, matchId),
    dispatchReplayExtractIfEnabled(supabaseAdmin, matchId),
    teardownAfterMatchEnd(supabaseAdmin, matchId),
  ]);
}

export async function POST(req: NextRequest) {
  const denied = machineSecretGuard(
    req.headers.get('x-matchzy-token'),
    process.env.INGEST_REMOTE_LOG_SECRET,
    'MatchZy remote log not configured',
  );
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const supabaseAdmin = getAdminClient();

  // Best-effort and deferred: this fires on every event MatchZy sends, including high-frequency ones
  // like round_end, so none of this adds latency to the ack MatchZy is waiting on. Covers map_result
  // too (parseMatchzyEventIdentity/putLiveScoreEvent both recognize it), so there's no separate path
  // needed for the final score. Both writes are independent, so one `after()` runs them concurrently
  // rather than paying for two separate registrations on this route's highest-frequency path.
  const identity = parseMatchzyEventIdentity(body);
  if (identity) {
    afterBestEffort(`matchzy-log: per-event side effects for match ${identity.matchid}`, async () => {
      const [contact, liveScore] = await Promise.allSettled([
        putMatchzyContact(identity.matchid, identity.event),
        putLiveScoreEvent(supabaseAdmin, body),
      ]);
      if (contact.status === 'rejected') {
        console.error(`matchzy-log: record contact for match ${identity.matchid} failed:`, contact.reason);
      }
      if (liveScore.status === 'rejected') {
        console.error(`matchzy-log: record live score for match ${identity.matchid} failed:`, liveScore.reason);
      }
    });
  }

  const result = parseMapResultEvent(body);
  if (!result) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  await putMapResult(result.matchid, result);
  afterBestEffort(`matchzy-log: triggerDemoPipeline(${result.matchid})`, () => triggerDemoPipeline(supabaseAdmin, result.matchid));
  return NextResponse.json({ ok: true, matchId: result.matchid });
}
