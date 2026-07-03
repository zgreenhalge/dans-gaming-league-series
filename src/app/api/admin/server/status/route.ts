// Raw DatHost server status for the admin server console — distinct from
// /api/matches/[id]/server/status, which is match-scoped and reads the DB state machine. This reads
// the live DatHost server directly, plus which match (if any) currently occupies it.

import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { dathostServerId, getServer, type DathostServer } from '@/lib/dathost';
import { getActiveServerMatch, type ActiveServerMatch } from '@/lib/dathost-lifecycle';

export interface AdminServerStatus {
  configured: boolean;
  server: DathostServer | null;
  active: ActiveServerMatch | null;
  error: string | null;
}

export async function GET() {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  let serverId: string;
  try {
    serverId = dathostServerId();
  } catch {
    return NextResponse.json(
      { configured: false, server: null, active: null, error: null } satisfies AdminServerStatus,
    );
  }

  let server: DathostServer | null = null;
  let error: string | null = null;
  try {
    server = await getServer(serverId);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not reach DatHost';
  }

  const active = await getActiveServerMatch(getAdminClient());
  return NextResponse.json({ configured: true, server, active, error } satisfies AdminServerStatus);
}
