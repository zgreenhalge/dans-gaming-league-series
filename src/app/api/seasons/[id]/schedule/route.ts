import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSeason, getSeasonRoster, getSeasonScheduleDraft } from '@/lib/queries';
import { generateSeasonScheduleDraft, deleteSeasonScheduleDraft } from '@/lib/season-schedule-draft-engine';
import type { DoubleheaderPolicy } from '@/lib/season-schedule';

const supabaseAdmin = getAdminClient();

/**
 * Generates (or fully regenerates) a regular season's matchup draft from its current roster
 * (`season_players`) — `buildRosterSchedule()`'s output persisted into
 * `season_schedule_draft_weeks`/`_matches`. Admin-only, and only while the season is `UPCOMING`,
 * matching the window `SeasonRosterPanel` keeps the roster editable in — the draft is meant to be
 * generated once the roster is settled, then hand-edited, then confirmed (confirmation isn't built
 * yet). Always a full regenerate; there's no partial/reset-remaining mode yet since that depends on
 * confirm/materialize existing first.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json({ error: 'Season must be UPCOMING to generate its matchup draft' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const doubleheaderPolicy: DoubleheaderPolicy = (body as { doubleheaderPolicy?: DoubleheaderPolicy })?.doubleheaderPolicy === 'never' ? 'never' : 'auto';

  const roster = await getSeasonRoster(seasonId);
  const playerIds = roster.map((r) => r.player_id);

  if (playerIds.length < 7 || playerIds.length > 19) {
    return NextResponse.json(
      { error: `This season's roster has ${playerIds.length} players — matchup generation supports 7-19` },
      { status: 400 },
    );
  }

  try {
    await generateSeasonScheduleDraft(supabaseAdmin, seasonId, playerIds, { doubleheaderPolicy });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const draft = await getSeasonScheduleDraft(seasonId);
  return NextResponse.json({ draft }, { status: 201 });
}

/** Clears a season's matchup draft with no side effects — nothing is materialized by generation,
 * so there's nothing to protect against here (unlike the gauntlet DELETE route's played-match
 * check). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  await deleteSeasonScheduleDraft(supabaseAdmin, seasonId);
  return NextResponse.json({ ok: true });
}
