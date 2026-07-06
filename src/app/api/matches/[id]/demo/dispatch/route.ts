// Re-dispatch the demo-ingest Action for a match (#136 console / #135 / #137). Session-gated (admin
// or in-match). Parses the demo already in R2 again — the manual counterpart to the machine-auth
// `/api/ingest/notify` auto-dispatch. Mirrors `replay/dispatch`: guards against an in-flight job,
// records `queued`, and fires the GitHub Action (heavy parsing runs there, not in this request).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireMatchAccess } from '@/lib/match-access';
import { dispatchWorkflow } from '@/lib/gh-dispatch';
import { parseMatchId } from '@/lib/util';
import { DEMO_INGEST_JOB_TYPE as JOB_TYPE, DEMO_INGEST_IN_PROGRESS } from '@/lib/demo/ingestResult';

export async function POST(
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

  const supabaseAdmin = getAdminClient();

  // Don't fire a second Action while one is already working this match.
  const { data: existing } = await supabaseAdmin
    .from('background_jobs')
    .select('status')
    .eq('job_type', JOB_TYPE)
    .eq('match_id', matchId)
    .maybeSingle();
  const existingStatus = (existing as { status?: string } | null)?.status;
  if (existingStatus && DEMO_INGEST_IN_PROGRESS.has(existingStatus)) {
    return NextResponse.json({ ok: true, status: existingStatus, alreadyRunning: true });
  }

  const dispatch = await dispatchWorkflow('demo-ingest.yml', { match_id: String(matchId) });
  if (!dispatch.ok) {
    return NextResponse.json(
      { error: `Could not start a re-parse: ${dispatch.error}` },
      { status: 503 },
    );
  }

  const now = new Date().toISOString();
  await supabaseAdmin.from('background_jobs').upsert(
    { job_type: JOB_TYPE, match_id: matchId, status: 'queued', stage: 'queued', error_message: null, updated_at: now },
    { onConflict: 'job_type,match_id' },
  );

  return NextResponse.json({ ok: true, status: 'queued' });
}
