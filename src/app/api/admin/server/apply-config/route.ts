// Manually apply a named config set + a pinned workshop map to the shared DatHost server, outside
// of match provisioning. Settings-only — does not start the server (see /server/start).

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { dathostServerId, applyConfigSet } from '@/lib/dathost';

export async function POST(req: NextRequest) {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = await req.json().catch(() => null);
  const configSet = typeof body?.configSet === 'string' ? body.configSet : '';
  const mapWorkshopId = typeof body?.mapWorkshopId === 'string' ? body.mapWorkshopId.trim() : '';
  if (!configSet) return NextResponse.json({ error: 'configSet is required' }, { status: 400 });
  if (!mapWorkshopId) return NextResponse.json({ error: 'mapWorkshopId is required' }, { status: 400 });

  try {
    await applyConfigSet(dathostServerId(), configSet, { mapWorkshopId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Apply failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
