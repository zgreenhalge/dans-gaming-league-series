// Stop a scrim on the shared DatHost server — any signed-in player. Refuses (409) only if a real
// DGLS match currently holds the server; a scrim (or any other casual use with no DGLS match
// attached) is always stoppable, since there's no per-scrim ownership to check against.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { dathostServerId, stopServer } from '@/lib/dathost';
import { getActiveServerMatch } from '@/lib/dathost-lifecycle';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serverId = dathostServerId();
  const active = await getActiveServerMatch(getAdminClient());
  if (active) {
    return NextResponse.json(
      { error: `${active.label} is currently ${active.serverState} on this server.`, code: 'server_occupied' },
      { status: 409 },
    );
  }

  try {
    await stopServer(serverId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not stop the server' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
