import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSeason, getSeasonLeaderboard, getLinkedGauntlet, getGauntletRounds } from '@/lib/queries';
import { seedBracket, getSeedBands } from '@/lib/gauntlet-engine';

const supabaseAdmin = getAdminClient();

/**
 * Seeds an already-built (but unseeded) gauntlet bracket from the regular season's *current*
 * canonical-sort leaderboard order, then materializes round 1 (and any pod that becomes fully
 * filled as a result, e.g. an all-bye pod). Call once the regular season's standings are final —
 * nothing enforces that here; it's an admin operational call, same as the rest of this feature.
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

  const gauntletSeason = await getLinkedGauntlet(regularSeason.name);
  if (!gauntletSeason) {
    return NextResponse.json({ error: 'This season has no gauntlet shape to seed — build it first' }, { status: 404 });
  }

  // Round rows only exist once at least one pod has materialized — re-seeding an already-seeded
  // bracket would silently rewrite gauntlet_pod_slots.player_id out of sync with the matches/stats
  // already materialized under the old seeding, corrupting the frozen historical record.
  const existingRounds = await getGauntletRounds(gauntletSeason.id);
  if (existingRounds.length > 0) {
    return NextResponse.json({ error: 'This gauntlet is already seeded' }, { status: 409 });
  }

  const leaderboard = await getSeasonLeaderboard(regularSeasonId);
  const N = leaderboard.length;

  // round1.length + byes.length reflects the shape's *actual* persisted seed count regardless of
  // what N we pass in here — it's the right value to diff against the current roster size.
  const bands = await getSeedBands(supabaseAdmin, gauntletSeason.id, N);
  const shapeSeedCount = bands.round1.length + bands.byes.length;
  if (shapeSeedCount === 0) {
    return NextResponse.json({ error: 'This gauntlet has no bracket shape to seed — build it first' }, { status: 404 });
  }
  if (shapeSeedCount !== N) {
    return NextResponse.json(
      {
        error: `Roster has drifted since the bracket was built (shape expects ${shapeSeedCount} qualifiers, season currently has ${N}). Reset and rebuild the bracket instead of seeding.`,
      },
      { status: 409 },
    );
  }

  const playerBySeed = new Map<number, number>();
  leaderboard.forEach((row, i) => playerBySeed.set(i + 1, row.player_id));

  try {
    await seedBracket(supabaseAdmin, gauntletSeason.id, playerBySeed);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const nameBySeed = new Map(leaderboard.map((row, i) => [i + 1, row.player_name]));
  const toNames = (seeds: number[]) => seeds.map((seed) => nameBySeed.get(seed));

  return NextResponse.json({
    season: gauntletSeason,
    seed_bands: {
      byes: toNames(bands.byes),
      playing: toNames(bands.round1),
      relegated: toNames(bands.dropped),
    },
  });
}
