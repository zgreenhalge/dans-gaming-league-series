// Read / dispose of a match's pending demo-ingest result (Phase 3). Session-gated (admin or in-match).
//   GET    → the staged DemoIngestResult (from R2) + the background_jobs status, or 404 if none.
//   DELETE → remove the R2 artifact + mark the job (confirmed | dismissed). Called by the review block
//            after a successful confirm (→ PATCH /score) or a dismiss.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireMatchAccess } from '@/lib/match-access';
import { getR2Object, deleteR2Object, headDemoObject, demoResultKey, mapResultKey } from '@/lib/r2';
import { gunzipMaybe } from '@/lib/gzip';
import { isPlayedScore, parseMatchId } from '@/lib/util';
import { isVetoComplete, computeGauntletOrPlayoff, type VetoFields } from '@/lib/veto';
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

type OrphanGateRow = VetoFields & {
  final_score: string | null;
  is_playoff_game: boolean;
  weeks: { seasons: { is_gauntlet: boolean } | null } | null;
};

/**
 * Whether this match is in the one state an unprocessed-but-present demo would actually be
 * suspicious: pick/ban finished (so a server could have been provisioned and the match played) but
 * no score recorded yet. Gates the R2 existence check below to that single match, on demand, when its
 * own page is viewed — never a bucket-wide scan across every match.
 */
async function isAwaitingScoreAfterVeto(matchId: number): Promise<boolean> {
  const { data } = await getAdminClient()
    .from('matches')
    .select(
      'final_score, is_playoff_game, shirts_ban, shirts_ban2, skins_ban1, skins_ban2, shirts_pick, skins_starting_side, weeks(seasons(is_gauntlet))',
    )
    .eq('id', matchId)
    .maybeSingle();
  if (!data) return false;
  const m = data as unknown as OrphanGateRow;
  if (isPlayedScore(m.final_score)) return false;
  const isGauntlet = m.weeks?.seasons?.is_gauntlet ?? false;
  return isVetoComplete(m, computeGauntletOrPlayoff(isGauntlet, m.is_playoff_game));
}

// The Worker retries its notify call for up to ~2.5s after the demo lands in R2 (`notifyWithRetry` in
// `infra/worker/src/index.ts`) before giving up. Without a grace period, a page load landing in that
// window would read "demo in R2, no job yet" and flash the manual-trigger button during a routine,
// still-in-progress upload — not an actual failure. Comfortably longer than the retry span itself.
const ORPHANED_DEMO_GRACE_MS = 15_000;

/** Whether an unprocessed demo has been sitting in R2 long enough to be considered abandoned rather
 *  than mid-upload, for a match where that would actually be suspicious (see above). */
async function findOrphanedDemo(matchId: number): Promise<boolean> {
  if (!(await isAwaitingScoreAfterVeto(matchId))) return false;
  const head = await headDemoObject(matchId);
  if (!head?.lastModified) return false;
  return Date.now() - head.lastModified.getTime() >= ORPHANED_DEMO_GRACE_MS;
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
    // No staged artifact. If there's also no job at all (status null — the ingest notify never
    // fired, or its dispatch was lost) *and* this match is actually in the window where a demo could
    // legitimately exist already (veto done, not yet scored), check R2 for one old enough to be
    // considered abandoned rather than still uploading, and offer a manual trigger instead of asking
    // for a re-upload. This never fires for a match that hasn't started or is already scored.
    const hasDemo = status ? false : await findOrphanedDemo(matchId);
    return NextResponse.json({ status, result: null, hasDemo });
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
