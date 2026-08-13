import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSeason } from '@/lib/queries';
import { deleteSeasonScheduleDraft } from '@/lib/season-schedule-draft-engine';

/**
 * Deletes an UPCOMING regular season outright. UPCOMING is the one stage a season has no schedule or
 * results yet — nothing in this app ever writes `weeks` rows for a season before it goes live (that
 * only happens through the historical CSV ingestion pipeline), so there's nothing to lose. Refuses
 * anything else: gauntlet seasons are never UPCOMING (born ACTIVE) and have their own reset route
 * (`DELETE /api/seasons/[id]/gauntlet`); ACTIVE/COMPLETED/ARCHIVED seasons always carry real history,
 * with no force override here.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  if (!season) {
    return NextResponse.json({ error: 'Season not found' }, { status: 404 });
  }
  if (season.status !== 'UPCOMING' || season.is_gauntlet) {
    return NextResponse.json({ error: 'Only an upcoming season can be deleted' }, { status: 400 });
  }

  // Defensive — this app never creates weeks for an UPCOMING season, but refuse rather than orphan
  // or FK-fail if one somehow exists (a manually-entered row, a season predating this guarantee).
  const { count, error: weeksErr } = await supabaseAdmin
    .from('weeks')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', seasonId);
  if (weeksErr) {
    return NextResponse.json({ error: weeksErr.message }, { status: 500 });
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'This season already has a schedule and cannot be deleted here' },
      { status: 400 },
    );
  }

  // Roster signups (season_players) and any matchup draft are only meaningful before matches
  // exist, and this season has none yet — clear them first so their FKs to `seasons` don't block
  // the delete.
  try {
    await deleteSeasonScheduleDraft(supabaseAdmin, seasonId);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const { error: rosterErr } = await supabaseAdmin.from('season_players').delete().eq('season_id', seasonId);
  if (rosterErr) {
    return NextResponse.json({ error: rosterErr.message }, { status: 500 });
  }

  const { error: deleteErr } = await supabaseAdmin.from('seasons').delete().eq('id', seasonId);
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
