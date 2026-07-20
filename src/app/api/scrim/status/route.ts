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
import { isServerLive } from '@/lib/util';
import {
  getActiveServerMatch,
  findNearbyUnscoredMatch,
  type ActiveServerMatch,
  type NearbyUnscoredMatch,
} from '@/lib/dathost-lifecycle';
import { parseConnectedPlayers, linesSinceMarker, SCRIM_BOOT_MARKER, type ConnectedPlayer } from '@/lib/server-players';
import { reconcileScrimSession } from '@/lib/scrim-session';

export interface ScrimStatus {
  configured: boolean;
  server: DathostServer | null;
  connect: string | null;
  active: ActiveServerMatch | null;
  connectedPlayers: ConnectedPlayer[];
  blockingMatch: NearbyUnscoredMatch | null;
  /** `playerId` of whoever started the current scrim, or `null` if none is running. */
  startedBy: number | null;
  /** Display name of whoever started the current scrim, or `null` if none is running. */
  startedByName: string | null;
  /** Whether the requesting session may stop the current scrim (owner or admin). */
  canStop: boolean;
  error: string | null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const playerId = session?.user?.playerId;
  if (!playerId) {
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
      startedBy: null,
      startedByName: null,
      canStop: false,
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
  // `reconcileScrimSession` and the console-log read are independent — both only depend on `server`,
  // already resolved above — so they run together rather than one paying for the other's round trip.
  // Only worth reading the console log while the box is actually up. Discard everything before this
  // boot's marker line — the server is reused, so its log otherwise still carries stale "connected"
  // residue from whatever last used it (see `SCRIM_BOOT_MARKER`).
  const [scrimSession, connectedPlayers] = await Promise.all([
    reconcileScrimSession(supabaseAdmin, server),
    isServerLive(server)
      ? getConsoleLines(serverId)
          .then((lines) => parseConnectedPlayers(linesSinceMarker(lines, SCRIM_BOOT_MARKER)))
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  return NextResponse.json({
    configured: true,
    server,
    connect,
    active,
    connectedPlayers,
    blockingMatch,
    startedBy: scrimSession?.startedBy ?? null,
    startedByName: scrimSession?.startedByName ?? null,
    canStop: !scrimSession || scrimSession.startedBy === playerId || !!session.user.isAdmin,
    error,
  } satisfies ScrimStatus);
}
