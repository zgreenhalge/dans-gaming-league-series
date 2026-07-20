import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { recordJobStatus, dispatchAndRecordFailure } from '@/lib/background-jobs';
import { REPLAY_EXTRACT_JOB_TYPE as JOB_TYPE } from '@/lib/jobs';
import { parseMatchId } from '@/lib/util';

// Dispatches Action A (`replay-extract`) for a match. The app only *triggers* the
// GitHub job — all heavy parsing runs there (see docs/replay.md). This endpoint is
// the primary guard against duplicate in-flight jobs.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const matchId = parseMatchId(id);
  if (matchId === null) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const playerId = session.user.playerId;
  const supabaseAdmin = getAdminClient();

  // Authorize: admin or a player in the match.
  const [{ data: playerRow }, { data: matchStats }] = await Promise.all([
    supabaseAdmin.from('players').select('is_admin').eq('id', playerId).maybeSingle(),
    supabaseAdmin.from('player_match_stats').select('player_id').eq('match_id', matchId),
  ]);
  const isAdmin = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
  const isInMatch = ((matchStats ?? []) as { player_id: number }[]).some(
    (s) => s.player_id === playerId,
  );
  if (!isAdmin && !isInMatch) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Guard: no-op if a job is already in flight for this match.
  const { data: existing } = await supabaseAdmin
    .from('background_jobs')
    .select('status')
    .eq('job_type', JOB_TYPE)
    .eq('match_id', matchId)
    .maybeSingle();
  const existingStatus = (existing as { status?: string } | null)?.status;
  if (existingStatus === 'queued' || existingStatus === 'running') {
    return NextResponse.json({ status: existingStatus, alreadyRunning: true });
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
  const { error: recordErr } = await recordJobStatus(supabaseAdmin, JOB_TYPE, { column: 'match_id', id: matchId }, {
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
  await supabaseAdmin.from('matches').update({ replay_status: 'queued' }).eq('id', matchId);

  const dispatch = await dispatchAndRecordFailure(supabaseAdmin, {
    jobType: JOB_TYPE,
    key: { column: 'match_id', id: matchId },
    workflowFile: 'replay-extract.yml',
    inputs: { match_id: String(matchId) },
    subject: { table: 'matches', column: 'replay_status', id: matchId },
  });
  if (!dispatch.ok) {
    return NextResponse.json(
      { error: 'Failed to dispatch replay job', detail: dispatch.error },
      { status: 502 },
    );
  }

  return NextResponse.json({ status: 'queued' });
}
