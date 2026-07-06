// Raw start for the shared DatHost server — no match-state writes (unlike match provisioning). For
// the admin server console, used independently of any match. Refuses (409) if the server is occupied
// (a DGLS match holds it, or live players are on it outside any match) unless `override: true`.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { dathostServerId, startServer, getServer } from '@/lib/dathost';
import { getServerOccupancy, occupancyMessage } from '@/lib/dathost-lifecycle';

export async function POST(req: NextRequest) {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = await req.json().catch(() => ({}));
  const override = body?.override === true;

  const serverId = dathostServerId();
  const server = await getServer(serverId).catch(() => null);
  const occupancy = await getServerOccupancy(getAdminClient(), server);
  if (occupancy.occupied && !override) {
    return NextResponse.json(
      { error: occupancyMessage(occupancy), code: 'server_occupied', ...occupancy },
      { status: 409 },
    );
  }

  try {
    await startServer(serverId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Start failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
