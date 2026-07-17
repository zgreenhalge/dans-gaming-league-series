// Start a casual scrim on the shared DatHost server — any signed-in player, free-form roster (no
// DGLS roster/veto, no stats). Applies the golden config at a chosen map and boots the server, same
// primitives the admin console's "Apply config set" + "Start" use, minus the admin-only override:
// refuses outright (409) if the server is occupied or if a league match is scheduled within the hour
// and hasn't been scored yet — a scrim never bumps a real match.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { dathostServerId, applyConfigSet, startServer, getServer } from '@/lib/dathost';
import { pushCfgFiles } from '@/lib/dathost-config';
import { getServerOccupancy, occupancyMessage, findNearbyUnscoredMatch } from '@/lib/dathost-lifecycle';

const WORKSHOP_ID_RE = /^\d+$/;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const mapWorkshopId = typeof body?.mapWorkshopId === 'string' ? body.mapWorkshopId.trim() : '';
  if (!WORKSHOP_ID_RE.test(mapWorkshopId)) {
    return NextResponse.json({ error: 'mapWorkshopId must be a numeric Steam workshop ID' }, { status: 400 });
  }

  const serverId = dathostServerId();
  const supabaseAdmin = getAdminClient();

  const blockingMatch = await findNearbyUnscoredMatch(supabaseAdmin);
  if (blockingMatch) {
    return NextResponse.json(
      {
        error: `${blockingMatch.label} is scheduled too close to now and hasn't been scored yet — the shared server is reserved for it.`,
        code: 'match_window',
        blockingMatch,
      },
      { status: 409 },
    );
  }

  const server = await getServer(serverId).catch(() => null);
  const occupancy = await getServerOccupancy(supabaseAdmin, server);
  if (occupancy.occupied) {
    return NextResponse.json(
      { error: occupancyMessage(occupancy), code: 'server_occupied', ...occupancy },
      { status: 409 },
    );
  }

  try {
    await applyConfigSet(serverId, 'golden', { mapWorkshopId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not configure the server' }, { status: 502 });
  }

  const cfgResults = await pushCfgFiles(serverId);
  const cfgFailed = cfgResults.filter((r) => !r.ok);
  if (cfgFailed.length) {
    console.warn(`scrims/start: ${cfgFailed.length} cfg file(s) failed to push:`, cfgFailed);
  }

  try {
    await startServer(serverId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not start the server' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
