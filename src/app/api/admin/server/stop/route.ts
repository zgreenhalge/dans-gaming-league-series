// Raw stop for the shared DatHost server — no match-state writes (unlike
// /api/matches/[id]/server/teardown, which also updates the owning match's server_state). For the
// admin server console, used independently of any match. A stale `live` match row left behind by a
// raw stop self-corrects on next view via getReconciledServerState — read-only, downgrade-only.
// Refuses (409) if the server is occupied (a DGLS match holds it, or live players are on it outside
// any match) unless `override: true` — this is the raw counterpart to `/matches/[id]/server/teardown`,
// which the admin console's "Tear down" button already uses for the match-aware case. Goes through
// `stopSharedServer` (not the raw `stopServer`) so an admin stopping the server also clears any
// active `scrim_sessions` row — otherwise a scrim stopped this way (instead of via
// `/api/scrim/stop`) would leave the singleton stuck.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { dathostServerId, getServer } from '@/lib/dathost';
import { getServerOccupancy, occupancyMessage, stopSharedServer } from '@/lib/dathost-lifecycle';

export async function POST(req: NextRequest) {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = await req.json().catch(() => ({}));
  const override = body?.override === true;

  const serverId = dathostServerId();
  const supabaseAdmin = getAdminClient();
  const server = await getServer(serverId).catch(() => null);
  const occupancy = await getServerOccupancy(supabaseAdmin, server);
  if (occupancy.occupied && !override) {
    return NextResponse.json(
      { error: occupancyMessage(occupancy), code: 'server_occupied', ...occupancy },
      { status: 409 },
    );
  }

  try {
    await stopSharedServer(supabaseAdmin, serverId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Stop failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
