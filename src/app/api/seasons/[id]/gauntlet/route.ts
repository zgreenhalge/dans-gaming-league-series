import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSeason, getLinkedGauntlet, getGauntletRounds, getGauntletBracketShape } from '@/lib/queries';
import { isPlayedScore } from '@/lib/util';
import { tryBuildGauntletShape, deleteGauntletSeason } from '@/lib/gauntlet-engine';

const supabaseAdmin = getAdminClient();

/**
 * Creates the paired "Season N Gauntlet" season row for a regular season and builds its bracket
 * *shape* — pods and slots, with every slot unseeded (`player_id` null). The shape only depends on
 * the qualifier count, not on who qualified, so this can run as soon as the regular season's roster
 * is fixed (its full match schedule exists) — well before standings are final. Nothing is
 * materialized and nothing is playable until `POST .../gauntlet/seed` fills in seeds later.
 *
 * This is also called automatically by `activateSeason()` when a season goes live — this route is
 * the manual/admin equivalent for building a shape by hand (e.g. for a season that was already
 * ACTIVE before that automation existed).
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

  const body = await req.json().catch(() => ({}));
  const start_date: string | null = (body as { start_date?: string | null })?.start_date ?? null;
  if (start_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
    return NextResponse.json({ error: 'Invalid date format (expected YYYY-MM-DD)' }, { status: 400 });
  }

  const regularSeason = await getSeason(regularSeasonId);
  if (!regularSeason || regularSeason.is_gauntlet) {
    return NextResponse.json({ error: 'Regular season not found' }, { status: 404 });
  }
  if (regularSeason.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Season must be ACTIVE to start its gauntlet' }, { status: 400 });
  }

  let result;
  try {
    result = await tryBuildGauntletShape(supabaseAdmin, regularSeasonId, { startDate: start_date });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  if (result.status === 'already-exists') {
    return NextResponse.json({ error: 'This season already has a gauntlet' }, { status: 409 });
  }
  if (result.status === 'not-eligible') {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  const pods = await getGauntletBracketShape(result.gauntletSeasonId);

  return NextResponse.json(
    {
      shape: { qualifiers: result.qualifiers, games: result.games, rounds: result.rounds },
      pods,
    },
    { status: 201 },
  );
}

/**
 * Resets a gauntlet — deletes the gauntlet season and everything materialized under it (pods,
 * slots, matches, stats, weeks), freeing the regular season up to have its bracket rebuilt. Refuses
 * once any match has a played score unless `force: true` is passed, since that discards real
 * results with no way to recover them. There is no partial reset either way.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const regularSeasonId = Number(id);
  if (!Number.isFinite(regularSeasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const force = (body as { force?: boolean })?.force === true;

  const regularSeason = await getSeason(regularSeasonId);
  if (!regularSeason || regularSeason.is_gauntlet) {
    return NextResponse.json({ error: 'Regular season not found' }, { status: 404 });
  }

  const gauntletSeason = await getLinkedGauntlet(regularSeason.name);
  if (!gauntletSeason) {
    return NextResponse.json({ error: 'This season has no gauntlet to reset' }, { status: 404 });
  }

  const rounds = await getGauntletRounds(gauntletSeason.id);
  const started = rounds.some((r) => r.matches.some((m) => isPlayedScore(m.final_score)));
  if (started && !force) {
    return NextResponse.json(
      { error: 'This gauntlet has already started — pass force to clear it anyway (results are not recoverable)' },
      { status: 409 },
    );
  }

  try {
    await deleteGauntletSeason(supabaseAdmin, gauntletSeason.id);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, forced: started && force });
}
