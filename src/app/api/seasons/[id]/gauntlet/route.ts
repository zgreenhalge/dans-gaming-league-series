import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSeason, getSeasonLeaderboard, getLinkedGauntlet, getGauntletRounds } from '@/lib/queries';
import { extractSeasonNumber, isPlayedScore } from '@/lib/util';
import { buildGauntletBracket } from '@/lib/gauntlet-bracket';
import { persistBracketShape, deleteGauntletSeason } from '@/lib/gauntlet-engine';

const supabaseAdmin = getAdminClient();

/**
 * Creates the paired "Season N Gauntlet" season row for a regular season and builds its bracket
 * *shape* — pods and slots, with every slot unseeded (`player_id` null). The shape only depends on
 * the qualifier count, not on who qualified, so this can run as soon as the regular season's roster
 * is fixed (its full match schedule exists) — well before standings are final. Nothing is
 * materialized and nothing is playable until `POST .../gauntlet/seed` fills in seeds later.
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

  const existingGauntlet = await getLinkedGauntlet(regularSeason.name);
  if (existingGauntlet) {
    return NextResponse.json({ error: 'This season already has a gauntlet' }, { status: 409 });
  }

  // Only the qualifier *count* matters for the shape — the roster, not the standings, which is
  // exactly what's available this early (getSeasonLeaderboard returns every rostered player, zero
  // stats and all, per rosterBySeason).
  const leaderboard = await getSeasonLeaderboard(regularSeasonId);
  const N = leaderboard.length;

  let plan;
  try {
    plan = buildGauntletBracket(N);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const seasonNumber = extractSeasonNumber(regularSeason.name);
  if (seasonNumber == null) {
    return NextResponse.json({ error: `Could not parse a season number from "${regularSeason.name}"` }, { status: 400 });
  }
  const gauntletName = `Season ${seasonNumber} Gauntlet`;

  const { data: gauntletSeason, error: insertErr } = await supabaseAdmin
    .from('seasons')
    .insert({
      name: gauntletName,
      is_gauntlet: true,
      status: 'ACTIVE',
      start_date,
      target_win_rounds: regularSeason.target_win_rounds,
    })
    .select('*')
    .single();
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }
  const gauntletSeasonId = (gauntletSeason as { id: number }).id;

  try {
    await persistBracketShape(supabaseAdmin, gauntletSeasonId, plan);
  } catch (err) {
    // Best-effort cleanup so a retry isn't permanently blocked by the "already has a gauntlet"
    // check above.
    await deleteGauntletSeason(supabaseAdmin, gauntletSeasonId).catch((cleanupErr) => {
      console.error(`gauntlet build cleanup(${gauntletSeasonId}) failed:`, cleanupErr);
    });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json(
    {
      season: gauntletSeason,
      shape: {
        qualifiers: N,
        games: plan.games,
        rounds: Math.max(...plan.pods.map((p) => p.round_number)),
      },
    },
    { status: 201 },
  );
}

/**
 * Resets a gauntlet that hasn't started play yet — deletes the gauntlet season and everything
 * materialized under it (pods, slots, matches, stats, weeks), freeing the regular season up to
 * have its bracket rebuilt. Refuses once any match has a played score; there is no partial reset.
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
  if (started) {
    return NextResponse.json({ error: 'This gauntlet has already started — it cannot be reset' }, { status: 409 });
  }

  try {
    await deleteGauntletSeason(supabaseAdmin, gauntletSeason.id);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
