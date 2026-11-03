// Provision the DatHost match server for a match. Session-gated (admin or in-match). Fired
// when the 5-stage veto completes. Returns immediately with `provisioning`; the boot + loadmatch
// (~15–20s) runs in `after()` and the client polls `…/server/status` for the connect string.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireMatchAccess } from '@/lib/match-access';
import {
  provisionMatchServer,
  matchzyConfigContext,
  findServerOccupant,
  provisionErrorHandler,
  getServerOccupancy,
  occupancyMessage,
} from '@/lib/dathost-lifecycle';
import { getServer } from '@/lib/dathost';
import { parseRouteId } from '@/lib/util';
import { afterBestEffort } from '@/lib/after';
import { clearOpsError } from '@/lib/ops-errors';
import { accessDenied } from '@/lib/access-control';
import { applyScrimSideChoice, isScrimMatch, leagueMatchBlockingScrim, scrimMatchPlaysAfter } from '@/lib/scrim-matches';
import { getScheduledUnplayedMatches } from '@/lib/queries';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matchId = parseRouteId(id);
  if (matchId === null) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const access = await requireMatchAccess(matchId);
  if (!access.ok) return accessDenied(access);

  // The DatHost server fetches this URL, so it must be the public deployment origin.
  const base = process.env.APP_BASE_URL ?? req.nextUrl.origin;
  const ctx = matchzyConfigContext(base, matchId);
  if (!ctx) {
    return NextResponse.json({ error: 'Server hosting not configured' }, { status: 503 });
  }

  // Refuse up front if another match holds the shared server (#134), so the panel gets a clear 409
  // instead of a silent no-op. `provisionMatchServer` re-checks authoritatively to close the race.
  const occupant = await findServerOccupant(getAdminClient(), matchId);
  if (occupant !== null) {
    return NextResponse.json(
      { error: `Another match (#${occupant}) is currently using the server.`, code: 'server_busy' },
      { status: 409 },
    );
  }

  // A scrim night plays its matches in order: a queued match waits for the ones ahead of it.
  const playsAfter = await scrimMatchPlaysAfter(getAdminClient(), matchId);
  if (playsAfter !== null) {
    return NextResponse.json({ error: `Match ${playsAfter} of this scrim night plays first.` }, { status: 409 });
  }
  // A scrim never bumps anything: a league match always gets the server, so no scrim match starts
  // within half an hour of one, and none starts while anyone is on the server — a DGLS match or
  // players outside one (`getServerOccupancy()`, the admin server console's own gate).
  if (await isScrimMatch(getAdminClient(), matchId)) {
    const serverId = process.env.DATHOST_SERVER_ID;
    const [scheduled, server] = await Promise.all([
      getScheduledUnplayedMatches(),
      serverId ? getServer(serverId).catch(() => null) : Promise.resolve(null),
    ]);
    const league = leagueMatchBlockingScrim(scheduled, new Date());
    if (league) {
      return NextResponse.json({ error: `${league.label} is scheduled within 30 minutes and gets the server.`, code: 'league_match_due' }, { status: 409 });
    }
    const occupancy = await getServerOccupancy(getAdminClient(), server);
    if (occupancy.occupied && occupancy.active?.matchId !== matchId) {
      return NextResponse.json({ error: occupancyMessage(occupancy), code: 'server_occupied' }, { status: 409 });
    }
  }

  // A scrim match's lobby side choice becomes its starting side now, before the server boots and loads
  // its config — so a random side is only flipped as the match starts.
  try {
    await applyScrimSideChoice(getAdminClient(), matchId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Setting the starting side failed' }, { status: 500 });
  }

  // Boot is slow (~15–20s) — run it after the response and let the client subscribe for updates.
  afterBestEffort(
    `provisionMatchServer(${matchId})`,
    async () => {
      await provisionMatchServer(getAdminClient(), matchId, ctx.configUrl, ctx.configAuth);
      await clearOpsError(getAdminClient(), 'match', matchId, 'server_provision');
    },
    provisionErrorHandler(getAdminClient(), 'provision', matchId),
  );

  return NextResponse.json({ ok: true, status: 'provisioning' }, { status: 202 });
}
