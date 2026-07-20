// Stop a scrim on the shared DatHost server. Refuses (409) if a real DGLS match currently holds the
// server, and (403) if a scrim session is active and the requester is neither the player who started
// it nor an admin — the shared server is being opened up to a wider group now, so stopping someone
// else's in-progress scrim needs to be a deliberate admin action, not a stray click. A stop is still
// allowed unconditionally when no `scrim_sessions` row exists at all (server on for some other reason
// — e.g. the admin console — with no per-session owner to check against).

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { dathostServerId } from '@/lib/dathost';
import { getActiveServerMatch, stopSharedServer } from '@/lib/dathost-lifecycle';
import { getScrimSession } from '@/lib/scrim-session';

export async function POST() {
  const session = await getServerSession(authOptions);
  const playerId = session?.user?.playerId;
  if (!playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serverId = dathostServerId();
  const supabaseAdmin = getAdminClient();

  const active = await getActiveServerMatch(supabaseAdmin);
  if (active) {
    return NextResponse.json(
      { error: `${active.label} is currently ${active.serverState} on this server.`, code: 'server_occupied' },
      { status: 409 },
    );
  }

  const scrimSession = await getScrimSession(supabaseAdmin);
  if (scrimSession && scrimSession.startedBy !== playerId && !session.user.isAdmin) {
    return NextResponse.json(
      { error: 'Only the player who started this scrim (or an admin) can stop it.', code: 'not_owner' },
      { status: 403 },
    );
  }

  try {
    await stopSharedServer(supabaseAdmin, serverId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not stop the server' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
