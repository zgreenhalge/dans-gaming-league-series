import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSeason } from '@/lib/queries';
import { rollbackSeasonScheduleDraft, mapScheduleDraftError } from '@/lib/season-schedule-draft-engine';

/**
 * Un-confirms (rolls back) a regular season's real schedule — the inverse of
 * `POST /api/seasons/[id]/schedule/confirm`. Admin-only. Deletes `weeks` (cascading `matches`/
 * `player_match_stats`) restricted to weeks with no played match yet — a week with even one played
 * match is left untouched and reported back in `protectedWeekNumbers`, never silently deleted.
 * `rollbackSeasonScheduleDraft()` never touches the draft rows the season was originally confirmed
 * from, so once every remaining real week is either rolled back or played, `POST .../schedule` /
 * `PATCH .../schedule` / `DELETE .../schedule` become usable again (they refuse while any real week
 * still exists). No season-status gate: this is only ever destructive to unplayed weeks regardless
 * of what stage the season is in, so there's nothing an UPCOMING/ACTIVE/COMPLETED check would add.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const supabaseAdmin = getAdminClient();
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const season = await getSeason(seasonId);
  if (!season || season.is_gauntlet) {
    return NextResponse.json({ error: 'Regular season not found' }, { status: 404 });
  }

  let result;
  try {
    result = await rollbackSeasonScheduleDraft(supabaseAdmin, seasonId);
  } catch (err) {
    const mapped = mapScheduleDraftError(err);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  if (result.status === 'not-materialized') {
    return NextResponse.json({ error: 'This season has no real schedule to roll back' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, weeksDeleted: result.weeksDeleted, protectedWeekNumbers: result.protectedWeekNumbers });
}
