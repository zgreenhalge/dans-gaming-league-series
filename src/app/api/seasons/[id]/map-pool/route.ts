import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSeason } from '@/lib/queries';
import { parseRouteId } from '@/lib/util';
import { parseMapPoolInput, upsertNewMaps } from '@/lib/season-map-pool';

/**
 * Sets (or clears, with an empty `map_pool`) an UPCOMING regular season's map pool — a season can
 * be created, and take roster signups, before its maps are decided. Newly-entered maps are added
 * to the `maps` table the same way season creation does. Once a season is live or archived its
 * pool is part of the veto history and is no longer editable.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const seasonId = parseRouteId(id);
  if (seasonId === null) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const season = await getSeason(seasonId);
  if (!season || season.is_gauntlet) {
    return NextResponse.json({ error: 'Regular season not found' }, { status: 404 });
  }
  if (season.status !== 'UPCOMING') {
    return NextResponse.json({ error: 'Only an upcoming season’s map pool can be edited' }, { status: 400 });
  }

  const input = parseMapPoolInput(await req.json().catch(() => null));
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const supabaseAdmin = getAdminClient();
  const mapErr = await upsertNewMaps(supabaseAdmin, input.newMaps);
  if (mapErr) {
    return NextResponse.json({ error: mapErr }, { status: 500 });
  }

  const { error } = await supabaseAdmin
    .from('seasons')
    .update({ map_pool: input.mapPool })
    .eq('id', seasonId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
