import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSeason } from '@/lib/queries';
import { activateSeason } from '@/lib/season-lifecycle';

const supabaseAdmin = getAdminClient();

/**
 * Regular-season status transitions. Only UPCOMING -> ACTIVE ("go live") is supported today —
 * ACTIVE -> COMPLETED is automatic (see `checkSeasonCompletion` in season-lifecycle.ts, hooked onto
 * the score route), and there's no admin path to ARCHIVED yet. Going live best-effort builds the
 * season's gauntlet bracket shape (`activateSeason`).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const status = (body as { status?: string })?.status;
  if (status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Only transitioning to ACTIVE is supported' }, { status: 400 });
  }

  const season = await getSeason(seasonId);
  if (!season || season.is_gauntlet) {
    return NextResponse.json({ error: 'Regular season not found' }, { status: 404 });
  }
  if (season.status !== 'UPCOMING') {
    return NextResponse.json({ error: `Season is ${season.status}, not UPCOMING` }, { status: 409 });
  }

  try {
    await activateSeason(supabaseAdmin, seasonId);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
