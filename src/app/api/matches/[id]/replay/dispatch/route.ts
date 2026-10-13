import { NextRequest, NextResponse } from 'next/server';
import { requireMatchAccess } from '@/lib/match-access';
import { accessDenied } from '@/lib/access-control';
import { getAdminClient } from '@/lib/supabase-admin';
import { recordJobStatus, dispatchAndRecordFailure, isJobInFlight, matchJobKey, mirrorSubjectStatus } from '@/lib/background-jobs';
import { REPLAY_EXTRACT_JOB_TYPE as JOB_TYPE } from '@/lib/jobs';
import { parseRouteId } from '@/lib/util';

// Dispatches Action A (`replay-extract`) for a match. The app only *triggers* the
// GitHub job — all heavy parsing runs there (see docs/replay.md). This endpoint is
// the primary guard against duplicate in-flight jobs.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matchId = parseRouteId(id);
  if (matchId === null) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  // Authorize: admin or a player in the match.
  const access = await requireMatchAccess(matchId);
  if (!access.ok) return accessDenied(access);
  const { playerId } = access;
  const supabaseAdmin = getAdminClient();

  // Guard: no-op if a job is already in flight for this match.
  if (await isJobInFlight(supabaseAdmin, JOB_TYPE, matchJobKey(matchId))) {
    return NextResponse.json({ alreadyRunning: true });
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO; // "owner/name"
  if (!token || !repo) {
    return NextResponse.json(
      { error: 'Replay dispatch is not configured (GITHUB_DISPATCH_TOKEN / GITHUB_REPO).' },
      { status: 503 },
    );
  }

  const now = new Date().toISOString();
  const { error: recordErr } = await recordJobStatus(supabaseAdmin, JOB_TYPE, matchJobKey(matchId), {
    status: 'queued',
    stage: 'validate',
    error_message: null,
    gh_run_id: null,
    gh_run_url: null,
    requested_by: playerId,
    created_at: now,
    started_at: null,
    finished_at: null,
  });
  if (recordErr) {
    return NextResponse.json(
      { error: `Could not record the job: ${recordErr}` },
      { status: 500 },
    );
  }
  const subject = { table: 'matches', column: 'replay_status', id: matchId };
  const { error: statusErr } = await mirrorSubjectStatus(supabaseAdmin, subject, 'queued');
  if (statusErr) {
    return NextResponse.json(
      { error: `Could not update replay status: ${statusErr}` },
      { status: 500 },
    );
  }

  const dispatch = await dispatchAndRecordFailure(supabaseAdmin, {
    jobType: JOB_TYPE,
    key: matchJobKey(matchId),
    workflowFile: 'replay-extract.yml',
    inputs: { match_id: String(matchId) },
    subject,
  });
  if (!dispatch.ok) {
    return NextResponse.json(
      { error: 'Failed to dispatch replay job', detail: dispatch.error },
      { status: 502 },
    );
  }

  return NextResponse.json({ status: 'queued' });
}
