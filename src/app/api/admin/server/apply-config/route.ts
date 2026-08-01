// Manually apply a named config set + a pinned workshop map to the shared DatHost server, outside
// of match provisioning. Reasserts both dimensions the golden-config compare checks — cs2_settings
// and the cfg/ files — so a manual apply actually clears drift shown by the compare view. Does not
// start the server (see /server/start). Refuses (409) if the server is occupied (a DGLS match holds
// it, or live players are on it outside any match) unless `override: true`.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { dathostServerId, applyConfigSet, getServer } from '@/lib/dathost';
import { resolveConfigSet, pushCfgFiles, listConfigSets } from '@/lib/dathost-config';
import { getServerOccupancy, occupancyMessage } from '@/lib/dathost-lifecycle';

const WORKSHOP_ID_RE = /^\d+$/;

export async function POST(req: NextRequest) {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = await req.json().catch(() => null);
  const configSet = typeof body?.configSet === 'string' ? body.configSet : '';
  const mapWorkshopId = typeof body?.mapWorkshopId === 'string' ? body.mapWorkshopId.trim() : '';
  const override = body?.override === true;

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

  let resolved;
  try {
    resolved = await resolveConfigSet(supabaseAdmin, configSet);
    await applyConfigSet(serverId, { server: resolved.server, cs2Settings: resolved.cs2Settings }, { mapWorkshopId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Apply failed' }, { status: 502 });
  }

  const cfgResults = await pushCfgFiles(serverId, resolved.cfgFiles);
  const cfgFailed = cfgResults.filter((r) => !r.ok);
  if (cfgFailed.length) {
    return NextResponse.json(
      { error: `Settings applied, but ${cfgFailed.length} cfg file(s) failed to push: ${cfgFailed.map((r) => r.remote).join(', ')}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
