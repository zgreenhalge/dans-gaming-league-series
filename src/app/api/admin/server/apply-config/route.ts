// Manually apply a named config set + a pinned workshop map to the shared DatHost server, outside
// of match provisioning. Reasserts both dimensions the golden-config compare checks — cs2_settings
// and the cfg/ files — so a manual apply actually clears drift shown by the compare view. Does not
// start the server (see /server/start). Refuses (409) if the server is occupied (a DGLS match holds
// it, or live players are on it outside any match) unless `override: true`.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { dathostServerId, applyConfigSet, getServer, CONFIG_SET_OPTIONS } from '@/lib/dathost';
import { pushCfgFiles } from '@/lib/dathost-config';
import { getServerOccupancy, occupancyMessage } from '@/lib/dathost-lifecycle';

const WORKSHOP_ID_RE = /^\d+$/;

export async function POST(req: NextRequest) {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = await req.json().catch(() => null);
  const configSet = typeof body?.configSet === 'string' ? body.configSet : '';
  const mapWorkshopId = typeof body?.mapWorkshopId === 'string' ? body.mapWorkshopId.trim() : '';
  const override = body?.override === true;

  if (!CONFIG_SET_OPTIONS.some((c) => c.key === configSet)) {
    return NextResponse.json(
      { error: `Unknown config set "${configSet}" — valid keys: ${CONFIG_SET_OPTIONS.map((c) => c.key).join(', ')}` },
      { status: 400 },
    );
  }
  if (!WORKSHOP_ID_RE.test(mapWorkshopId)) {
    return NextResponse.json({ error: 'mapWorkshopId must be a numeric Steam workshop ID' }, { status: 400 });
  }

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
    await applyConfigSet(serverId, configSet, { mapWorkshopId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Apply failed' }, { status: 502 });
  }

  const cfgResults = await pushCfgFiles(serverId);
  const cfgFailed = cfgResults.filter((r) => !r.ok);
  if (cfgFailed.length) {
    return NextResponse.json(
      { error: `Settings applied, but ${cfgFailed.length} cfg file(s) failed to push: ${cfgFailed.map((r) => r.remote).join(', ')}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
