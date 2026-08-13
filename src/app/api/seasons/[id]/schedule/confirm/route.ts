import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSeason } from '@/lib/queries';
import { confirmSeasonScheduleDraft, mapScheduleDraftError } from '@/lib/season-schedule-draft-engine';

/**
 * Confirms a regular season's matchup draft — materializes it into real `weeks`/`matches`/
 * `player_match_stats` once (and only once) both `validateDraftIntegrity()` and
 * `validateDraftCompleteness()` pass. Admin-only, and only while the season is `UPCOMING`. Refuses
 * with 409 if the season already has a real schedule (no double-materialize; the check runs inside
 * confirmSeasonScheduleDraft()'s shared schedule-draft lock, so two concurrent confirms can't both
 * pass it) or if another generate/save/delete/confirm is already in flight for this season
 * (ScheduleDraftLockedError), 400 if no draft exists yet, and 400 with the specific
 * integrity/completeness gaps if the draft isn't ready — the draft itself is never touched by a
 * rejected attempt, so more edits plus another confirm is the recovery path.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabaseAdmin = getAdminClient();
  const access = await requireAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const season = await getSeason(seasonId);
  if (!season || season.is_gauntlet) {
    return NextResponse.json({ error: 'Regular season not found' }, { status: 404 });
  }
  if (season.status !== 'UPCOMING') {
    return NextResponse.json({ error: 'Season must be UPCOMING to confirm its matchup draft' }, { status: 400 });
  }

  let result;
  try {
    result = await confirmSeasonScheduleDraft(supabaseAdmin, seasonId);
  } catch (err) {
    const mapped = mapScheduleDraftError(err);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  if (result.status === 'already-materialized') {
    return NextResponse.json({ error: 'This season already has a real schedule' }, { status: 409 });
  }

  if (result.status === 'no-draft') {
    return NextResponse.json({ error: 'No matchup draft exists yet — generate one first' }, { status: 400 });
  }

  if (result.status === 'invalid') {
    return NextResponse.json(
      {
        error: 'Draft is not ready to confirm',
        integrityIssues: result.integrityIssues,
        missingTeammatePairs: result.missingTeammatePairs,
        missingOpponentPairs: result.missingOpponentPairs,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, weeksCreated: result.weeksCreated, matchesCreated: result.matchesCreated }, { status: 201 });
}
