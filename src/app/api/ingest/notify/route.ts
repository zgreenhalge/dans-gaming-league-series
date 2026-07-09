// Machine-authenticated ingestion notify endpoint (Phase 2 of the DatHost + MatchZy initiative —
// see `dathost_handoff/DATHOST_PHASE0_PLAN.md`).
//
// The Cloudflare Worker `ingest-demo` streams the MatchZy-POSTed demo straight to R2 at
// `demoKey(matchId)` (Vercel's 4.5 MB body cap can't receive a GOTV demo), then fire-and-forgets a
// POST here with `{ matchId }`. This route NEVER receives the demo bytes — it only reads from R2.
//
// Phase-2 scope: confirm the demo actually landed, confirm the match is set up (roster present), and
// record a `received` row in the existing `background_jobs` state machine (`job_type='demo_ingest'`,
// mirroring the replay pipeline). Downstream stays the existing manual parse → confirm flow. Phase 3
// will extend this to auto-parse + stage a result.
//
// Auth: shared secret in the `x-ingest-secret` header, compared in constant time against
// `INGEST_NOTIFY_SECRET`. No session — this is called by the Worker, not a browser.

import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { NextRequest, NextResponse, after } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { r2, R2_BUCKET, demoKey } from '@/lib/r2';
import { dispatchWorkflow } from '@/lib/gh-dispatch';
import { teardownMatchServer } from '@/lib/dathost-lifecycle';
import { recordOpsError, clearOpsError } from '@/lib/ops-errors';
import { machineSecretGuard } from '@/lib/machine-auth';
import { DEMO_INGEST_JOB_TYPE as JOB_TYPE, DEMO_INGEST_IN_PROGRESS } from '@/lib/demo/ingestResult';

export async function POST(req: NextRequest) {
  const denied = machineSecretGuard(
    req.headers.get('x-ingest-secret'),
    process.env.INGEST_NOTIFY_SECRET,
    'Ingestion not configured',
  );
  if (denied) return denied;

  let body: { matchId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const matchId = Number(body.matchId);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return NextResponse.json({ error: 'Invalid matchId' }, { status: 400 });
  }

  const supabaseAdmin = getAdminClient();

  // Match must exist and be set up with its roster (player_match_stats rows). getReplayInputs /
  // the parser both require these, so absence means this demo can't be processed yet.
  const [{ data: matchRow }, { data: rosterRows }] = await Promise.all([
    supabaseAdmin.from('matches').select('id').eq('id', matchId).maybeSingle(),
    supabaseAdmin.from('player_match_stats').select('player_id').eq('match_id', matchId),
  ]);
  if (!matchRow) {
    return NextResponse.json({ error: `Match ${matchId} not found` }, { status: 404 });
  }
  const rosterCount = rosterRows?.length ?? 0;
  if (rosterCount === 0) {
    return NextResponse.json(
      { error: `Match ${matchId} has no roster (player_match_stats) yet` },
      { status: 422 },
    );
  }

  // Confirm the demo bytes actually landed in R2 (the Worker writes before notifying).
  let demoBytes: number | null = null;
  try {
    const head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: demoKey(matchId) }));
    demoBytes = head.ContentLength ?? null;
  } catch {
    return NextResponse.json(
      { error: `No demo found in R2 at ${demoKey(matchId)}` },
      { status: 404 },
    );
  }

  // Duplicate guard: if a job for this match is already in flight (Worker/MatchZy retry, or a
  // double-POST), don't reset its status or fire a second redundant Action.
  const { data: existing } = await supabaseAdmin
    .from('background_jobs')
    .select('status')
    .eq('job_type', JOB_TYPE)
    .eq('match_id', matchId)
    .maybeSingle();
  const existingStatus = (existing as { status?: string } | null)?.status;
  if (existingStatus && DEMO_INGEST_IN_PROGRESS.has(existingStatus)) {
    return NextResponse.json({ ok: true, matchId, status: existingStatus, deduped: true });
  }

  // Record `received` in the shared job state machine (reused from the replay pipeline).
  const now = new Date().toISOString();
  const { error: upsertErr } = await supabaseAdmin.from('background_jobs').upsert(
    {
      job_type: JOB_TYPE,
      match_id: matchId,
      status: 'received',
      stage: 'received',
      error_message: null,
      created_at: now,
      updated_at: now,
    },
    { onConflict: 'job_type,match_id' },
  );
  if (upsertErr) {
    return NextResponse.json(
      { error: `Could not record ingestion: ${upsertErr.message}` },
      { status: 500 },
    );
  }

  // Kick off the demo-ingest Action (parse → quarantine → stage a result). Best-effort: if dispatch
  // isn't configured/fails, the demo is safely in R2 and the manual upload→parse→confirm flow still
  // covers it. On success, advance the job to `queued` (the Action moves it to running→parsed).
  const dispatch = await dispatchWorkflow('demo-ingest.yml', { match_id: String(matchId) });
  if (dispatch.ok) {
    // Only advance the row we just wrote — `.eq('status','received')` so a concurrent Action that
    // already moved it to running/parsed isn't clobbered back to queued.
    await supabaseAdmin
      .from('background_jobs')
      .update({ status: 'queued', stage: 'queued', updated_at: new Date().toISOString() })
      .eq('job_type', JOB_TYPE)
      .eq('match_id', matchId)
      .eq('status', 'received');
  } else {
    console.error(`demo-ingest dispatch failed for match ${matchId}: ${dispatch.error}`);
  }

  // The demo landing means the match is over → tear down the shared server now, without waiting for
  // the score write (#135). Best-effort, skipped when hosting isn't configured; `onlyIfOwnsServer`
  // so a demo for one match never stops another match's live server. Score-write teardown remains
  // the fallback.
  if (process.env.DATHOST_SERVER_ID) {
    after(async () => {
      try {
        await teardownMatchServer(supabaseAdmin, matchId, { onlyIfOwnsServer: true });
        await clearOpsError(supabaseAdmin, 'match', matchId, 'server_teardown');
      } catch (err) {
        console.error(`notify auto-teardown(${matchId}) failed:`, err);
        await recordOpsError(supabaseAdmin, 'match', matchId, 'server_teardown', `Server teardown failed: ${(err as Error).message}`);
      }
    });
  }

  return NextResponse.json({
    ok: true,
    matchId,
    status: dispatch.ok ? 'queued' : 'received',
    demoBytes,
    rosterCount,
  });
}
