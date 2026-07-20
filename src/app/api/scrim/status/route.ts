// Live status for the public scrim page — the raw DatHost server state, which DGLS match (if any)
// currently occupies it, the currently-connected roster derived from the console log
// (`server-players.ts`), and whether a nearby unscored league match blocks starting a scrim right
// now. Read-only; any signed-in player (session checked by the page itself — this mirrors the admin
// status route's shape but isn't admin-gated, since starting/stopping a scrim isn't an admin action).

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { dathostServerId, getServer, getConsoleLines, connectHost, type DathostServer } from '@/lib/dathost';
import {
  getActiveServerMatch,
  findNearbyUnscoredMatch,
  type ActiveServerMatch,
  type NearbyUnscoredMatch,
} from '@/lib/dathost-lifecycle';
import { parseConnectedPlayers, type ConnectedPlayer } from '@/lib/server-players';

export interface ScrimStatus {
  configured: boolean;
  server: DathostServer | null;
  connect: string | null;
  active: ActiveServerMatch | null;
  connectedPlayers: ConnectedPlayer[];
  blockingMatch: NearbyUnscoredMatch | null;
  error: string | null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let serverId: string;
  try {
    serverId = dathostServerId();
  } catch {
    return NextResponse.json({
      configured: false,
      server: null,
      connect: null,
      active: null,
      connectedPlayers: [],
      blockingMatch: null,
      error: null,
    } satisfies ScrimStatus);
  }

  const supabaseAdmin = getAdminClient();
  const [serverResult, active, blockingMatch] = await Promise.all([
    getServer(serverId)
      .then((s) => ({ server: s, error: null as string | null }))
      .catch((err) => ({ server: null, error: err instanceof Error ? err.message : 'Could not reach DatHost' })),
    getActiveServerMatch(supabaseAdmin),
    findNearbyUnscoredMatch(supabaseAdmin),
  ]);

  const { server, error } = serverResult;
  const connect = server ? connectHost(server) : null;
  // Only worth reading the console log while the box is actually up.
  const connectedPlayers =
    server?.on && !server.booting
      ? await getConsoleLines(serverId)
          .then(parseConnectedPlayers)
          .catch(() => [])
      : [];

  return NextResponse.json({
    configured: true,
    server,
    connect,
    active,
    connectedPlayers,
    blockingMatch,
    error,
  } satisfies ScrimStatus);
}
