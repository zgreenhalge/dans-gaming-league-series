import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';

// Dispatches Action A (`replay-extract`) for a match. The app only *triggers* the
// GitHub job — all heavy parsing runs there (see docs/replay.md). This endpoint is
// the primary guard against duplicate in-flight jobs.

const JOB_TYPE = 'replay_extract';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isFinite(matchId)) {
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
  const { error: upsertErr } = await supabaseAdmin.from('background_jobs').upsert(
    {
      job_type: JOB_TYPE,
      match_id: matchId,
      status: 'queued',
      stage: 'validate',
      error_message: null,
      gh_run_id: null,
      gh_run_url: null,
      requested_by: playerId,
      created_at: now,
      started_at: null,
      finished_at: null,
      updated_at: now,
    },
    { onConflict: 'job_type,match_id' },
  );
  if (upsertErr) {
    return NextResponse.json(
      { error: `Could not record the job: ${upsertErr.message}` },
      { status: 500 },
    );
  }
  await supabaseAdmin.from('matches').update({ replay_status: 'queued' }).eq('id', matchId);

  // Roll the just-queued job back to `failed` so a transient dispatch error never
  // leaves the match wedged in `queued` (the in-flight guard above would otherwise
  // block every retry — see docs/replay.md).
  async function markFailed(message: string) {
    await supabaseAdmin
      .from('background_jobs')
      .update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() })
      .eq('job_type', JOB_TYPE)
      .eq('match_id', matchId);
    await supabaseAdmin.from('matches').update({ replay_status: 'failed' }).eq('id', matchId);
  }

  // Fire the workflow via workflow_dispatch (gated by Actions: write, unlike
  // repository_dispatch which needs Contents: write). The workflow must exist on
  // the dispatched ref's default branch to be triggerable.
  const ref = process.env.GITHUB_DISPATCH_REF || 'main';
  let ghRes: Response;
  try {
    ghRes = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/replay-extract.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref,
          inputs: { match_id: String(matchId) },
        }),
      },
    );
  } catch (err) {
    // Network-level rejection (DNS, timeout, connection reset) — fetch never resolved.
    const detail = err instanceof Error ? err.message : String(err);
    await markFailed(`dispatch request failed: ${detail}`);
    return NextResponse.json(
      { error: 'Failed to reach GitHub to dispatch replay job', detail },
      { status: 502 },
    );
  }

  if (!ghRes.ok) {
    const detail = await ghRes.text();
    await markFailed(`dispatch failed: ${ghRes.status}`);
    return NextResponse.json(
      { error: `Failed to dispatch replay job (${ghRes.status})`, detail },
      { status: 502 },
    );
  }

  return NextResponse.json({ status: 'queued' });
}
