import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { deleteUpcomingSeason, SeasonDeleteRefusedError } from '@/lib/season-setup';
import { parseRouteId } from '@/lib/util';
import { accessDenied } from '@/lib/access-control';

/**
 * Deletes an UPCOMING regular season outright (`deleteUpcomingSeason()`: its schedule draft, roster and
 * the season, in one transaction). UPCOMING is the one stage a season has no schedule or results yet —
 * nothing in this app ever writes `weeks` rows for a season before it goes live, so there's nothing to
 * lose. Refuses anything else: gauntlet seasons are never UPCOMING (born ACTIVE) and have their own
 * reset route (`DELETE /api/seasons/[id]/gauntlet`); ACTIVE/ARCHIVED seasons always carry real history,
 * with no force override here; a season with `weeks` already has a schedule. Admin only.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) return accessDenied(access);

  const seasonId = parseRouteId((await params).id);
  if (seasonId === null) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  try {
    await deleteUpcomingSeason(getAdminClient(), seasonId);
  } catch (err) {
    if (err instanceof SeasonDeleteRefusedError) {
      return NextResponse.json({ error: err.message }, { status: err.reason === 'not-found' ? 404 : 400 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Deleting the season failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
