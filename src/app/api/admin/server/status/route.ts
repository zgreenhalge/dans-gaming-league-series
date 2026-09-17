// Raw DatHost server status for the admin server console — distinct from
// /api/matches/[id]/server/status, which is match-scoped and reads the DB state machine. This reads
// the live DatHost server directly, plus which match (if any) currently occupies it.

import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { dathostServerId, getServer, connectHost, type DathostServer } from '@/lib/dathost';
import { getActiveServerMatch, type ActiveServerMatch } from '@/lib/dathost-lifecycle';
import { getConnectedPlayers, type ConnectedPlayer } from '@/lib/server-players';

export interface AdminServerStatus {
  configured: boolean;
  server: DathostServer | null;
  connect: string | null;
  active: ActiveServerMatch | null;
  connectedPlayers: ConnectedPlayer[];
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
      { configured: false, server: null, connect: null, active: null, connectedPlayers: [], error: null } satisfies AdminServerStatus,
    );
  }

  // Independent calls (DatHost REST vs. Supabase) — run concurrently rather than paying the sum of
  // both latencies on a route hit every 15s per open tab plus after every action.
  const serverPromise = getServer(serverId)
    .then((s) => ({ server: s, error: null as string | null }))
    .catch((err) => ({ server: null, error: err instanceof Error ? err.message : 'Could not reach DatHost' }));
  // Only depends on `server` (from serverPromise above), not on `active` — chained off serverPromise
  // directly instead of waiting for the whole batch below to settle first.
  const connectedPlayersPromise = serverPromise.then(({ server }) => getConnectedPlayers(serverId, server));

  const [serverResult, active, connectedPlayers] = await Promise.all([
    serverPromise,
    getActiveServerMatch(getAdminClient()),
    connectedPlayersPromise,
  ]);

  const { server, error } = serverResult;
  const connect = server ? connectHost(server) : null;
  return NextResponse.json({ configured: true, server, connect, active, connectedPlayers, error } satisfies AdminServerStatus);
}
