import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { trySeedGauntlet } from '@/lib/gauntlet-engine';

const supabaseAdmin = getAdminClient();

/**
 * Seeds an already-built (but unseeded) gauntlet bracket from the regular season's *current*
 * canonical-sort leaderboard order, then materializes round 1 (and any pod that becomes fully
 * filled as a result, e.g. an all-bye pod).
 *
 * This is also called automatically by `checkSeasonCompletion()` once every match in the regular
 * season has been played — this route is the manual/admin equivalent, for seeding on demand rather
 * than waiting for the last match to be scored.
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

  let result;
  try {
    result = await trySeedGauntlet(supabaseAdmin, regularSeasonId);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  switch (result.status) {
    case 'no-shape':
      return NextResponse.json({ error: 'This season has no gauntlet shape to seed — build it first' }, { status: 404 });
    case 'already-seeded':
      return NextResponse.json({ error: 'This gauntlet is already seeded' }, { status: 409 });
    case 'drift':
      return NextResponse.json(
        {
          error: `Roster has drifted since the bracket was built (shape expects ${result.shapeSeedCount} qualifiers, season currently has ${result.currentCount}). Reset and rebuild the bracket instead of seeding.`,
        },
        { status: 409 },
      );
    case 'seeded':
      return NextResponse.json({ seed_bands: result.bands });
  }
}
