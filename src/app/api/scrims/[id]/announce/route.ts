// Posts a scrim night's Discord message by hand (`POST`, admin only): the announcement, or the night
// message once the night is due one, replacing any message on record (`postScrimNightMessage()`). The
// admin menu's "Post announcement" and the Retry action on a live scrim-night `ops_errors` row.
// 502 when Discord refuses it; the failure is recorded to `ops_errors` as well.

import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { accessDenied } from '@/lib/access-control';
import { getAdminClient } from '@/lib/supabase-admin';
import { postScrimNightMessage } from '@/lib/discord-scrim-notify';
import { parseRouteId } from '@/lib/util';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) return accessDenied(access);

  const nightId = parseRouteId((await params).id);
  if (nightId === null) return NextResponse.json({ error: 'Invalid night ID' }, { status: 400 });

  const result = await postScrimNightMessage(getAdminClient(), nightId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'Night not found' ? 404 : 502 });
  }
  return NextResponse.json({ ok: true, posted: result.posted });
}
