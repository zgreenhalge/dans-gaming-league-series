// Provision the DatHost match server for a match. Session-gated (admin or in-match). Fired
// when the 5-stage veto completes. Returns immediately with `provisioning`; the boot + loadmatch
// (~15–20s) runs in `after()` and the client polls `…/server/status` for the connect string.
//
// Body (optional): `{ force: true }` starts a league match on a server that is live outside any DGLS
// match (a pug, someone warming up) — the confirmation the match panel sends after a forceable
// `server_occupied` 409. Without it, `provisionMatchServer()` refuses a live server. A scrim match's
// body is `{ revision }` instead: the match's revision as the starter saw it (409 `match_changed`
// when the lobby changed it since). A scrim match whose boot failed is retried with no body, from
// whatever its revision now is.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireMatchAccess } from '@/lib/match-access';
import {
  provisionMatchServer,
  matchzyConfigContext,
  findServerOccupant,
  provisionErrorHandler,
  getActiveServerMatch,
  fetchServerStateRow,
  teardownMatchServer,
  liveServerOutsideMatch,
  occupancyMessage,
  playersOutsideMatchMessage,
} from '@/lib/dathost-lifecycle';
import { getServer } from '@/lib/dathost';
import { parseRouteId, playersOnServer } from '@/lib/util';
import { afterBestEffort } from '@/lib/after';
import { clearOpsError } from '@/lib/ops-errors';
import { accessDenied, writeFailed } from '@/lib/access-control';
import {
  applyScrimSideChoice,
  claimScrimMatchStart,
  leagueMatchBlockingScrim,
  parseScrimRevision,
  scrimMatchPlaysAfter,
  scrimNightIdOf,
  SCRIM_REVISION_INVALID,
} from '@/lib/scrim-matches';
import { scrimConflictResponse } from '@/lib/scrim-route-errors';
import { SCRIM_LEAGUE_CLEARANCE_MS } from '@/lib/scrim-schedule';
import { getScheduledUnplayedMatches, getScrimNightMatches } from '@/lib/queries';

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

  // A scrim match waits its turn and bumps nothing but its own night's previous match, whose game is
  // over: a night plays its matches in order, a league match always gets the server (no scrim match
  // starts within half an hour of one), and none starts while anyone is on the server — a DGLS match
  // or players outside one (`getServer()`'s player count, as the admin server console gates on).
  const body = (await req.json().catch(() => null)) as { force?: unknown; revision?: unknown } | null;
  const nightId = await scrimNightIdOf(getAdminClient(), matchId);
  const isScrim = nightId !== null;
  const revision = isScrim ? parseScrimRevision(body?.revision) : null;
  // A start whose boot failed is retried without a revision (the admin ops list sends none): the
  // claim reads the current one.
  const retryingFailedStart = isScrim && revision === null && (await fetchServerStateRow(getAdminClient(), matchId))?.server_state === 'failed';
  if (isScrim && revision === null && !retryingFailedStart) {
    return NextResponse.json({ error: SCRIM_REVISION_INVALID }, { status: 400 });
  }
  if (isScrim) {
    const serverId = process.env.DATHOST_SERVER_ID;
    const [nightMatches, scheduled] = await Promise.all([getScrimNightMatches(nightId), getScheduledUnplayedMatches()]);
    const playsAfter = scrimMatchPlaysAfter(nightMatches, matchId);
    if (playsAfter !== null) {
      return NextResponse.json({ error: `Match ${playsAfter} of this scrim night plays first.` }, { status: 409 });
    }
    const league = leagueMatchBlockingScrim(scheduled, new Date());
    if (league) {
      return NextResponse.json({ error: `${league.label} is scheduled within ${SCRIM_LEAGUE_CLEARANCE_MS / 60_000} minutes and gets the server.`, code: 'league_match_due' }, { status: 409 });
    }
    // The night's previous match, its game over, may still be on the server for its scoreboard grace
    // period: this match takes the server from it now rather than waiting out the delay.
    let tookOver = false;
    const active = await getActiveServerMatch(getAdminClient());
    if (active && active.matchId !== matchId) {
      const sameNight = (await scrimNightIdOf(getAdminClient(), active.matchId)) === nightId;
      if (!(sameNight && active.serverState === 'tearing_down')) {
        return NextResponse.json({ error: occupancyMessage({ active, playersOnline: null, occupied: true }), code: 'server_occupied' }, { status: 409 });
      }
      await teardownMatchServer(getAdminClient(), active.matchId);
      tookOver = true;
    }
    // Players on the server outside any DGLS match block it, read after the above so a teardown it just
    // ran isn't counted (the previous match's players are still listed until DatHost catches up).
    const server = !tookOver && serverId ? await getServer(serverId).catch(() => null) : null;
    const playersOnline = playersOnServer(server);
    if (playersOnline > 0) {
      return NextResponse.json({ error: playersOutsideMatchMessage(playersOnline), code: 'server_occupied' }, { status: 409 });
    }
  }

  // Refuse up front if another match holds the shared server (#134), so the panel gets a clear 409
  // instead of a silent no-op. `provisionMatchServer` re-checks authoritatively to close the race.
  let occupant: number | null;
  try {
    occupant = await findServerOccupant(getAdminClient(), matchId);
  } catch (err) {
    return writeFailed(err, 'Checking the server failed');
  }
  if (occupant !== null) {
    return NextResponse.json(
      { error: `Another match (#${occupant}) is currently using the server.`, code: 'server_busy' },
      { status: 409 },
    );
  }

  // A league match can take over a server that is live outside any DGLS match (another DGLS match
  // holding it was refused above), but only once the person starting it confirms (`force`), since
  // starting restarts it and kicks anyone on it.
  const takeOverLiveServer = !isScrim && body?.force === true;
  const serverId = process.env.DATHOST_SERVER_ID;
  if (!isScrim && !takeOverLiveServer && serverId) {
    const live = await liveServerOutsideMatch(serverId);
    if (live) {
      const playersOnline = live.players_online ?? 0;
      const error = playersOnline > 0
        ? `${playersOutsideMatchMessage(playersOnline)} Starting kicks them.`
        : 'The server is running outside a DGLS match. Starting restarts it.';
      return NextResponse.json({ error, code: 'server_occupied', forceable: true }, { status: 409 });
    }
  }

  // A scrim match claims its start (409 `match_changed` when someone changed it since its starter
  // loaded it; the claim makes any change sent from before the start refuse), and its lobby side choice
  // becomes its starting side now, before the server boots and loads its config — so a random side is
  // only flipped as it starts.
  try {
    if (isScrim) await claimScrimMatchStart(getAdminClient(), matchId, revision);
    await applyScrimSideChoice(getAdminClient(), matchId);
  } catch (err) {
    // The claim took a failed match to `provisioning`; with no boot coming, put it back so it can be retried.
    if (retryingFailedStart) {
      const { error } = await getAdminClient().from('match_server_state').update({ server_state: 'failed' }).eq('match_id', matchId).eq('server_state', 'provisioning');
      if (error) console.error(`Restoring failed server state for match ${matchId} failed:`, error.message);
    }
    const conflict = scrimConflictResponse(err);
    if (conflict) return conflict;
    return writeFailed(err, 'Setting the starting side failed');
  }

  // Boot is slow (~15–20s) — run it after the response and let the client subscribe for updates.
  afterBestEffort(
    `provisionMatchServer(${matchId})`,
    async () => {
      await provisionMatchServer(getAdminClient(), matchId, ctx.configUrl, ctx.configAuth, { takeOverLiveServer });
      await clearOpsError(getAdminClient(), 'match', matchId, 'server_provision');
    },
    provisionErrorHandler(getAdminClient(), 'provision', matchId),
  );

  return NextResponse.json({ ok: true, status: 'provisioning' }, { status: 202 });
}
