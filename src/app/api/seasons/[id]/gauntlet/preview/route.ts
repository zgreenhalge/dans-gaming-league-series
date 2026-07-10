import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getSeason, getSeasonLeaderboard, getLinkedGauntlet } from '@/lib/queries';
import { buildGauntletBracket, planToPreviewPods } from '@/lib/gauntlet-bracket';

/**
 * Computes what `POST /api/seasons/[id]/gauntlet` *would* build — qualifier count, games, rounds,
 * and the pod/slot shape — without writing anything. `buildGauntletBracket()` is pure, so this is
 * just that plus a DB read for the current roster size; nothing here is persisted. Lets the admin UI
 * show the bracket before committing to it (`CreateGauntletForm`'s preview/confirm/cancel flow).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const regularSeasonId = Number(id);
  if (!Number.isFinite(regularSeasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const regularSeason = await getSeason(regularSeasonId);
  if (!regularSeason || regularSeason.is_gauntlet) {
    return NextResponse.json({ error: 'Regular season not found' }, { status: 404 });
  }
  if (regularSeason.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Season must be ACTIVE to preview its gauntlet' }, { status: 400 });
  }

  const existingGauntlet = await getLinkedGauntlet(regularSeason.name);
  if (existingGauntlet) {
    return NextResponse.json({ error: 'This season already has a gauntlet' }, { status: 409 });
  }

  const leaderboard = await getSeasonLeaderboard(regularSeasonId);
  const qualifiers = leaderboard.length;

  let plan;
  try {
    plan = buildGauntletBracket(qualifiers);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const rounds = Math.max(...plan.pods.map((p) => p.round_number));

  return NextResponse.json({
    shape: { qualifiers, games: plan.games, rounds },
    pods: planToPreviewPods(plan),
  });
}
