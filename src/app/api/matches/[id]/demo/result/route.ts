// Read / dispose of a match's pending demo-ingest result (Phase 3). Session-gated (admin or in-match).
//   GET    → the staged DemoIngestResult (from R2) + the background_jobs status, or 404 if none.
//   DELETE → remove the R2 artifact + mark the job (confirmed | dismissed). Called by the review block
//            after a successful confirm (→ PATCH /score) or a dismiss.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireMatchAccess } from '@/lib/match-access';
import { getR2Object, deleteR2Object, demoResultKey, mapResultKey } from '@/lib/r2';
import { gunzipMaybe } from '@/lib/gzip';
import { parseMatchId } from '@/lib/util';
import { DEMO_INGEST_JOB_TYPE as JOB_TYPE, type DemoIngestResult } from '@/lib/demo/ingestResult';
import { recordJobStatus, matchJobKey } from '@/lib/background-jobs';

async function jobStatus(matchId: number): Promise<string | null> {
  const { data } = await getAdminClient()
    .from('background_jobs')
    .select('status')
    .eq('job_type', JOB_TYPE)
    .eq('match_id', matchId)
    .maybeSingle();
  return (data as { status?: string } | null)?.status ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matchId = parseMatchId(id);
  if (matchId === null) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }
  const access = await requireMatchAccess(matchId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const [status, buf] = await Promise.all([jobStatus(matchId), getR2Object(demoResultKey(matchId))]);
  if (!buf) {
    // No staged artifact — return the job status alone so the UI can show "parsing…" vs nothing.
    return NextResponse.json({ status, result: null });
  }
  // A truncated/corrupt artifact (partial write, aborted Action) must not 500 into a silently
  // swallowed error — surface it so the UI can show a failure and let the user dismiss it.
  try {
    const result = JSON.parse(gunzipMaybe(buf).toString()) as DemoIngestResult;
    return NextResponse.json({ status, result });
  } catch {
    return NextResponse.json({
      status,
      result: null,
      resultError: 'The staged demo result is unreadable (corrupt or incomplete).',
    });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matchId = parseMatchId(id);
  if (matchId === null) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }
  const access = await requireMatchAccess(matchId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const disposition = req.nextUrl.searchParams.get('disposition') === 'confirmed' ? 'confirmed' : 'dismissed';
  // The map_result oracle's job is done once a score is confirmed; a dismiss leaves it in place in
  // case the demo is reparsed and re-staged.
  const cleanup =
    disposition === 'confirmed'
      ? [deleteR2Object(demoResultKey(matchId)), deleteR2Object(mapResultKey(matchId))]
      : [deleteR2Object(demoResultKey(matchId))];
  await Promise.all(cleanup);
  await recordJobStatus(getAdminClient(), JOB_TYPE, matchJobKey(matchId), {
    status: disposition,
    stage: disposition,
  });

  return NextResponse.json({ ok: true, status: disposition });
}
