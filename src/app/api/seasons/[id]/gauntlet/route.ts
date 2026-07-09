import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSeason, getSeasonLeaderboard, getLinkedGauntlet } from '@/lib/queries';
import { extractSeasonNumber } from '@/lib/util';
import { buildGauntletBracket } from '@/lib/gauntlet-bracket';
import { persistAndMaterializeBracket } from '@/lib/gauntlet-engine';

const supabaseAdmin = getAdminClient();

/**
 * Creates the paired "Season N Gauntlet" season row for a regular season and builds + materializes
 * its bracket in one action — there is no separate "create a gauntlet season" step, since an
 * unbracketed gauntlet season is not a state anything else in the app expects.
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

  const leaderboard = await getSeasonLeaderboard(regularSeasonId);
  const N = leaderboard.length;

  let plan;
  try {
    plan = buildGauntletBracket(N);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const playerBySeed = new Map<number, number>();
  leaderboard.forEach((row, i) => playerBySeed.set(i + 1, row.player_id));

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
    await persistAndMaterializeBracket(supabaseAdmin, gauntletSeasonId, plan, playerBySeed);
  } catch (err) {
    // Best-effort cleanup so a retry isn't permanently blocked by the "already has a gauntlet"
    // check above: delete the pods (cascades to their slots) and the season row itself. Any
    // matches/weeks already materialized before the failure are left as harmless orphans — nothing
    // still references them once the season row is gone, and cleaning those up would need
    // visibility into this DB's existing FK cascade rules that isn't available here.
    await supabaseAdmin.from('gauntlet_pods').delete().eq('season_id', gauntletSeasonId);
    await supabaseAdmin.from('seasons').delete().eq('id', gauntletSeasonId);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const nameBySeed = new Map(leaderboard.map((row, i) => [i + 1, row.player_name]));
  const round1Seeds = new Set(
    plan.pods.filter((p) => p.round_number === 1).flatMap((p) => p.slots).filter((s) => s.source_kind === 'seed').map((s) => s.source_seed!),
  );
  const byeSeeds = plan.pods
    .filter((p) => p.round_number > 1)
    .flatMap((p) => p.slots)
    .filter((s) => s.source_kind === 'seed')
    .map((s) => s.source_seed!);

  return NextResponse.json(
    {
      season: gauntletSeason,
      seed_bands: {
        byes: byeSeeds.map((seed) => nameBySeed.get(seed)),
        playing: [...round1Seeds].sort((a, b) => a - b).map((seed) => nameBySeed.get(seed)),
        relegated: plan.drops.map((seed) => nameBySeed.get(seed)),
      },
    },
    { status: 201 },
  );
}
