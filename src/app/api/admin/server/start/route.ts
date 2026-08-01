// Launch the shared DatHost server: apply a config set + map, boot it, and assert launch-time cvars
// (play-out-all-rounds / friendly) — the same one-click flow `/api/scrim/start` uses, so the admin
// console and scrim panel can't drift on what "start the server" means (#315). `/apply-config` stays
// the separate no-boot "reassert settings on an already-running server" action. Refuses (409) if the
// server is occupied (a DGLS match holds it, or live players are on it outside any match) unless
// `override: true`.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { dathostServerId, getServer } from '@/lib/dathost';
import { listConfigSets } from '@/lib/dathost-config';
import { getServerOccupancy, occupancyMessage, launchServer, pugModeCvarLine } from '@/lib/dathost-lifecycle';

const WORKSHOP_ID_RE = /^\d+$/;

export async function POST(req: NextRequest) {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = await req.json().catch(() => ({}));
  const override = body?.override === true;
  const configSet = typeof body?.configSet === 'string' ? body.configSet : '';
  const mapWorkshopId = typeof body?.mapWorkshopId === 'string' ? body.mapWorkshopId.trim() : '';
  const playout = body?.playout === true;
  const friendly = body?.friendly === true;

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
  const server = await getServer(serverId).catch(() => null);
  const occupancy = await getServerOccupancy(supabaseAdmin, server);
  if (occupancy.occupied && !override) {
    return NextResponse.json(
      { error: occupancyMessage(occupancy), code: 'server_occupied', ...occupancy },
      { status: 409 },
    );
  }

  try {
    await launchServer(supabaseAdmin, serverId, {
      configSetKey: configSet,
      mapWorkshopId,
      extraCvars: pugModeCvarLine({ playout, friendly }),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Start failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
