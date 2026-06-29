// Read / dispose of a match's pending demo-ingest result (Phase 3). Session-gated (admin or in-match).
//   GET    → the staged DemoIngestResult (from R2) + the background_jobs status, or 404 if none.
//   DELETE → remove the R2 artifact + mark the job (confirmed | dismissed). Called by the review block
//            after a successful confirm (→ PATCH /score) or a dismiss.

import { gunzipSync } from 'node:zlib';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireMatchAccess } from '@/lib/match-access';
import { getR2Object, deleteR2Object, demoResultKey } from '@/lib/r2';
import type { DemoIngestResult } from '@/lib/demo/ingestResult';

const JOB_TYPE = 'demo_ingest';

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
  const matchId = Number(id);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }
  const access = await requireMatchAccess(matchId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const status = await jobStatus(matchId);
  const buf = await getR2Object(demoResultKey(matchId));
  if (!buf) {
    // No staged artifact — return the job status alone so the UI can show "parsing…" vs nothing.
    return NextResponse.json({ status, result: null });
  }
  const result = JSON.parse(gunzipSync(buf).toString()) as DemoIngestResult;
  return NextResponse.json({ status, result });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }
  const access = await requireMatchAccess(matchId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const disposition = req.nextUrl.searchParams.get('disposition') === 'confirmed' ? 'confirmed' : 'dismissed';
  await deleteR2Object(demoResultKey(matchId));
  await getAdminClient()
    .from('background_jobs')
    .update({ status: disposition, stage: disposition, updated_at: new Date().toISOString() })
    .eq('job_type', JOB_TYPE)
    .eq('match_id', matchId);

  return NextResponse.json({ ok: true, status: disposition });
}
