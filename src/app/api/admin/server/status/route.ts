// Raw DatHost server status for the admin server console — distinct from
// /api/matches/[id]/server/status, which is match-scoped and reads the DB state machine. This reads
// the live DatHost server directly, plus which match (if any) currently occupies it.

import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { dathostServerId, getServer, connectHost, type DathostServer } from '@/lib/dathost';
import { getActiveServerMatch, type ActiveServerMatch } from '@/lib/dathost-lifecycle';

export interface AdminServerStatus {
  configured: boolean;
  server: DathostServer | null;
  connect: string | null;
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
      { configured: false, server: null, connect: null, active: null, error: null } satisfies AdminServerStatus,
    );
  }

  // Independent calls (DatHost REST vs. Supabase) — run concurrently rather than paying the sum of
  // both latencies on a route hit every 15s per open tab plus after every action.
  const [serverResult, active] = await Promise.all([
    getServer(serverId)
      .then((s) => ({ server: s, error: null as string | null }))
      .catch((err) => ({ server: null, error: err instanceof Error ? err.message : 'Could not reach DatHost' })),
    getActiveServerMatch(getAdminClient()),
  ]);

  const { server, error } = serverResult;
  const connect = server ? connectHost(server) : null;
  return NextResponse.json({ configured: true, server, connect, active, error } satisfies AdminServerStatus);
}
