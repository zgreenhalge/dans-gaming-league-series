// Start a casual scrim on the shared DatHost server — any signed-in player, free-form roster (no
// DGLS roster/veto, no stats). Applies the golden config at a chosen map and boots the server, same
// primitives the admin console's "Apply config set" + "Start" use, minus the admin-only override:
// refuses outright (409) if the server is occupied, a scrim is already running, or a league match is
// scheduled within the hour and hasn't been scored yet — a scrim never bumps a real match.
//
// Never calls `loadMatch` — with no roster loaded, MatchZy stays in Pug Mode (teams unlocked, players
// self-assign with `.ct`/`.t`/`.spec`). A `scrim_sessions` row is claimed atomically right before
// DatHost is touched (`claimScrimSession`), and released again if anything after that fails, so a
// failed start can't leave the singleton stuck "active" with no server actually running. Reconciled
// first too (`reconcileScrimSession`), so a session row left stale by a stop this app never observed
// (a DatHost idle timeout) can't block every future start.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { dathostServerId, getServer } from '@/lib/dathost';
import { getServerOccupancy, occupancyMessage, findNearbyUnscoredMatch, launchServer, pugModeCvarLine } from '@/lib/dathost-lifecycle';
import { claimScrimSession, releaseScrimSession, reconcileScrimSession } from '@/lib/scrim-session';
import { SCRIM_BOOT_MARKER } from '@/lib/server-players';

const WORKSHOP_ID_RE = /^\d+$/;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const playerId = session?.user?.playerId;
  if (!playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const mapWorkshopId = typeof body?.mapWorkshopId === 'string' ? body.mapWorkshopId.trim() : '';
  if (!WORKSHOP_ID_RE.test(mapWorkshopId)) {
    return NextResponse.json({ error: 'mapWorkshopId must be a numeric Steam workshop ID' }, { status: 400 });
  }
  const playout = body?.playout === true;
  const friendly = body?.friendly === true;

  const serverId = dathostServerId();
  const supabaseAdmin = getAdminClient();

  const [blockingMatch, server] = await Promise.all([findNearbyUnscoredMatch(supabaseAdmin), getServer(serverId).catch(() => null)]);
  if (blockingMatch) {
    return NextResponse.json(
      {
        error: `${blockingMatch.label} is scheduled too close to now and hasn't been scored yet — the shared server is reserved for it.`,
        code: 'match_window',
        blockingMatch,
      },
      { status: 409 },
    );
  }

  const occupancy = await getServerOccupancy(supabaseAdmin, server);
  if (occupancy.occupied) {
    return NextResponse.json(
      { error: occupancyMessage(occupancy), code: 'server_occupied', ...occupancy },
      { status: 409 },
    );
  }

  // A session row can outlive its scrim if the server was stopped some way this app never observed
  // (a DatHost idle timeout — the only stop path `stopSharedServer` doesn't cover). Clear a
  // stale row before claiming so it can't block every future start until someone happens to load
  // `/api/scrim/status` first.
  await reconcileScrimSession(supabaseAdmin, server);

  const claimed = await claimScrimSession(supabaseAdmin, playerId);
  if (!claimed) {
    return NextResponse.json({ error: 'A scrim is already running.', code: 'server_occupied' }, { status: 409 });
  }

  try {
    // `echo` (server console only, not broadcast to players) marks where this boot's console-log
    // history starts — see `SCRIM_BOOT_MARKER` — so the connected-roster read on `/api/scrim/status`
    // can discard residue left over from whatever last used the shared, reused server.
    await launchServer(supabaseAdmin, serverId, {
      configSetKey: 'golden',
      mapWorkshopId,
      extraCvars: `${pugModeCvarLine({ playout, friendly })}; echo ${SCRIM_BOOT_MARKER}`,
    });
  } catch (err) {
    await releaseScrimSession(supabaseAdmin);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not start the server' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
