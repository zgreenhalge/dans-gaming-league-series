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

import { timingSafeEqual } from 'node:crypto';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { r2, R2_BUCKET, demoKey } from '@/lib/r2';

const JOB_TYPE = 'demo_ingest';

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // timingSafeEqual throws on length mismatch
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const expected = process.env.INGEST_NOTIFY_SECRET;
  if (!expected) {
    // Fail closed: a missing secret must not become an open endpoint.
    return NextResponse.json({ error: 'Ingestion not configured' }, { status: 503 });
  }
  if (!secretsMatch(req.headers.get('x-ingest-secret'), expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  return NextResponse.json({ ok: true, matchId, status: 'received', demoBytes, rosterCount });
}
