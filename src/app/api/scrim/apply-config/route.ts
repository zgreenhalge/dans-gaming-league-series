// Reassert a config set on the shared DatHost server without starting it — the scrim-scoped
// counterpart to /api/admin/server/apply-config, gated exactly like /api/scrim/start: refused (409, no
// override) if the server is occupied, and refused if a league match is scheduled within the hour and
// hasn't been scored yet — a scrim never touches the server's config that close to a real match either.

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getAdminClient } from '@/lib/supabase-admin';
import { dathostServerId, getServer } from '@/lib/dathost';
import { listConfigSets } from '@/lib/dathost-config';
import { getServerOccupancy, occupancyMessage, findNearbyUnscoredMatch, applyConfigSetOnly } from '@/lib/dathost-lifecycle';

const WORKSHOP_ID_RE = /^\d+$/;

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const configSet = typeof body?.configSet === 'string' ? body.configSet : '';
  const mapWorkshopId = typeof body?.mapWorkshopId === 'string' ? body.mapWorkshopId.trim() : '';

  const supabaseAdmin = getAdminClient();

  const configSets = await listConfigSets(supabaseAdmin);
  if (!configSets.some((c) => c.key === configSet)) {
    return NextResponse.json(
      { error: `Unknown config set "${configSet}" — valid keys: ${configSets.map((c) => c.key).join(', ')}` },
      { status: 400 },
    );
  }
  if (!WORKSHOP_ID_RE.test(mapWorkshopId)) {
    return NextResponse.json({ error: 'mapWorkshopId must be a numeric Steam workshop ID' }, { status: 400 });
  }

  const serverId = dathostServerId();

  const [blockingMatch, server] = await Promise.all([findNearbyUnscoredMatch(supabaseAdmin), getServer(serverId).catch(() => null)]);
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

  const occupancy = await getServerOccupancy(supabaseAdmin, server);
  if (occupancy.occupied) {
    return NextResponse.json(
      { error: occupancyMessage(occupancy), code: 'server_occupied', ...occupancy },
      { status: 409 },
    );
  }

  let cfgResults;
  try {
    cfgResults = await applyConfigSetOnly(supabaseAdmin, serverId, { configSetKey: configSet, mapWorkshopId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Apply failed' }, { status: 502 });
  }

  const cfgFailed = cfgResults.filter((r) => !r.ok);
  if (cfgFailed.length) {
    return NextResponse.json(
      { error: `Settings applied, but ${cfgFailed.length} cfg file(s) failed to push: ${cfgFailed.map((r) => r.remote).join(', ')}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
