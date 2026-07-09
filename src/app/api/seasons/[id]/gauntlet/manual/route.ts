import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSeason } from '@/lib/queries';
import { createManualGauntletShell } from '@/lib/gauntlet-engine';

const supabaseAdmin = getAdminClient();

/**
 * Creates the paired "Season N Gauntlet" season row with no bracket shape — an empty shell for an
 * admin to hand-build rounds/matches into via `POST .../gauntlet/matches`, bypassing
 * `buildGauntletBracket()` entirely. For league sizes or bracket shapes the automated generator
 * doesn't cover.
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
    result = await createManualGauntletShell(supabaseAdmin, regularSeasonId, { startDate: start_date });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  if (result.status === 'already-exists') {
    return NextResponse.json({ error: 'This season already has a gauntlet' }, { status: 409 });
  }
  if (result.status === 'not-eligible') {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({ gauntletSeasonId: result.gauntletSeasonId }, { status: 201 });
}
