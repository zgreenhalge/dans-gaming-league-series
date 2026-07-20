// Per-match DatHost server lifecycle orchestration (Phase 4). Composes the `dathost.ts` client with
// the match's data and persists a small server-state machine on the `matches` row.
//
//   provision: provisioning → apply golden settings → start → wait ready → loadmatch → live
//   teardown:  stop → idle
//
// Server-side only. Requires these columns on `matches` (see dathost_handoff schema proposal):
//   server_state text, dathost_server_id text, connect_string text, server_started_at timestamptz
//
// Reuse model (D2): teardown stops the persistent server; it never deletes it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { mapSlug } from './maps';
import { matchLabel, isPlayedScore } from './util';
import { SCHEDULE_COLLISION_WINDOW_MS } from './schedule';
import {
  dathostServerId,
  applyGoldenSettings,
  startServer,
  stopServer,
  waitUntilReady,
  loadMatch,
  connectHost,
  workshopIdFromUrl,
  getServer,
  type DathostServer,
} from './dathost';
import { releaseScrimSession } from './scrim-session';
import { pushCfgFiles } from './dathost-config';

/**
 * Stops the shared server and releases any active scrim session in one call — the single choke point
 * every "stop the server" path (`/api/scrim/stop`, the raw admin console stop, real-match teardown
 * below) should go through, so a scrim session can never outlive a stop this app itself initiated.
 * Lives here rather than in `scrim-session.ts` since "what it takes to stop the one shared, reused
 * server" is this module's concern (it already tracks who else occupies it) — scrim-session.ts stays
 * scoped to the session row itself. Doesn't cover a stop DatHost initiates on its own (an idle
 * timeout) — that's what `reconcileScrimSession` is for.
 */
export async function stopSharedServer(supabaseAdmin: SupabaseClient, serverId: string): Promise<void> {
  await stopServer(serverId);
  await releaseScrimSession(supabaseAdmin);
}

export type ServerState = 'idle' | 'provisioning' | 'live' | 'tearing_down' | 'done' | 'failed';

/** Server-states in which a match currently occupies the single shared server (D2). */
const OCCUPYING_STATES: readonly ServerState[] = ['provisioning', 'live', 'tearing_down'];

/** Thrown when a provision is refused because another match already holds the shared server (#134). */
export class ServerBusyError extends Error {
  constructor(readonly occupantMatchId: number) {
    super(`The match server is already in use by match ${occupantMatchId}.`);
    this.name = 'ServerBusyError';
  }
}

/**
 * The id of another match currently occupying the shared server, or `null` if it's free (#134).
 * Since all matches reuse ONE server (D2), any *other* match in an occupying state holds it. Returns
 * `null` when hosting isn't configured (no server to contend for).
 */
export async function findServerOccupant(
  supabaseAdmin: SupabaseClient,
  exceptMatchId: number,
): Promise<number | null> {
  const serverId = process.env.DATHOST_SERVER_ID;
  if (!serverId) return null;
  const { data } = await supabaseAdmin
    .from('matches')
    .select('id')
    .eq('dathost_server_id', serverId)
    .in('server_state', OCCUPYING_STATES as unknown as string[])
    .neq('id', exceptMatchId)
    .limit(1);
  const rows = (data ?? []) as { id: number }[];
  return rows.length ? rows[0].id : null;
}

export interface NearbyUnscoredMatch {
  matchId: number;
  label: string;
  scheduledAt: string;
}

/**
 * A league match scheduled within `windowMs` of right now that hasn't been scored yet, or `null`.
 * Scrims share the one physical server with league matches (D2) — a match's scheduled time passing
 * doesn't mean the server is free, since it may still be mid-veto or mid-play. Nearest match wins if
 * more than one falls in the window.
 */
export async function findNearbyUnscoredMatch(
  supabaseAdmin: SupabaseClient,
  windowMs: number = SCHEDULE_COLLISION_WINDOW_MS,
): Promise<NearbyUnscoredMatch | null> {
  const now = Date.now();
  const { data } = await supabaseAdmin
    .from('matches')
    .select('id, match_number, scheduled_at, final_score, weeks(week_number, seasons(name))')
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', new Date(now - windowMs).toISOString())
    .lte('scheduled_at', new Date(now + windowMs).toISOString());
  const rows = (data ?? []) as unknown as {
    id: number;
    match_number: number | null;
    scheduled_at: string;
    final_score: string | null;
    weeks: { week_number: number | null; seasons: { name: string | null } | null } | null;
  }[];

  let best: NearbyUnscoredMatch | null = null;
  let bestDelta = Infinity;
  for (const row of rows) {
    if (isPlayedScore(row.final_score)) continue;
    const delta = Math.abs(new Date(row.scheduled_at).getTime() - now);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = {
        matchId: row.id,
        label: matchLabel({
          matchId: row.id,
          seasonName: row.weeks?.seasons?.name,
          weekNumber: row.weeks?.week_number,
          matchNumber: row.match_number,
        }),
        scheduledAt: row.scheduled_at,
      };
    }
  }
  return best;
}

async function setServerState(
  supabaseAdmin: SupabaseClient,
  matchId: number,
  fields: {
    server_state: ServerState;
    dathost_server_id?: string | null;
    connect_string?: string | null;
    server_started_at?: string | null;
  },
): Promise<void> {
  const { error } = await supabaseAdmin.from('matches').update(fields).eq('id', matchId);
  if (error) throw new Error(`Failed to write server_state for match ${matchId}: ${error.message}`);
}

/** Resolve the picked map's Steam workshop id from the `maps` table, or `null` if unknown. */
export async function resolveMapWorkshopId(
  supabaseAdmin: SupabaseClient,
  matchId: number,
): Promise<string | null> {
  const { data: match } = await supabaseAdmin
    .from('matches')
    .select('shirts_pick, picked_map')
    .eq('id', matchId)
    .maybeSingle();
  const name = (match as { shirts_pick: string | null; picked_map: string | null } | null);
  const mapName = name?.shirts_pick ?? name?.picked_map;
  if (!mapName) return null;
  const { data: mapRow } = await supabaseAdmin
    .from('maps')
    .select('workshop_url')
    .eq('slug', mapSlug(mapName))
    .maybeSingle();
  return workshopIdFromUrl((mapRow as { workshop_url: string | null } | null)?.workshop_url);
}

export interface MatchzyConfigContext {
  configUrl: string;
  configAuth: { headerKey: string; headerValue: string };
}

/**
 * Build the authenticated `matchzy_loadmatch_url` context for a match, or `null` if hosting isn't
 * configured (`MATCHZY_CONFIG_SECRET` unset). Shared by the provision route and the veto auto-trigger.
 */
export function matchzyConfigContext(baseUrl: string, matchId: number): MatchzyConfigContext | null {
  const secret = process.env.MATCHZY_CONFIG_SECRET;
  if (!secret) return null;
  return {
    configUrl: `${baseUrl}/api/matches/${matchId}/matchzy-config`,
    configAuth: { headerKey: 'X-MatchZy-Token', headerValue: secret },
  };
}

export interface ProvisionResult {
  connect: string; // `ip:port`
  serverId: string;
}

/**
 * Provision the match server: re-assert golden config (incl. the picked map), boot it, load the
 * MatchZy config, and persist the connect string. Marks `failed` and rethrows on any error.
 *
 * `configUrl` is the authenticated `matchzy_loadmatch_url` target (the `matchzy-config` route);
 * `configAuth` is the shared secret it checks.
 */
export async function provisionMatchServer(
  supabaseAdmin: SupabaseClient,
  matchId: number,
  configUrl: string,
  configAuth: { headerKey: string; headerValue: string },
): Promise<ProvisionResult> {
  const serverId = dathostServerId();

  // Hard safety (#134): never clobber a server another match is already using. Checked BEFORE we
  // claim (set `provisioning`), so a refusal doesn't mark THIS match failed. There's a tiny
  // check-then-claim window, but veto completions are seconds+ apart in practice and this turns the
  // common overlap from a silent mid-game clobber into a clean refusal.
  const occupant = await findServerOccupant(supabaseAdmin, matchId);
  if (occupant !== null) throw new ServerBusyError(occupant);

  try {
    await setServerState(supabaseAdmin, matchId, {
      server_state: 'provisioning',
      dathost_server_id: serverId,
      connect_string: null,
      server_started_at: new Date().toISOString(),
    });

    const mapWorkshopId = await resolveMapWorkshopId(supabaseAdmin, matchId);
    await applyGoldenSettings(serverId, { mapWorkshopId });
    // Reassert the versioned cfg files before boot (they're `exec`'d at boot / go-live), so the cfg
    // dimension can't drift from the repo. A per-file failure shouldn't block the match, so log and
    // continue rather than throw.
    const pushed = await pushCfgFiles(serverId);
    const failed = pushed.filter((p) => !p.ok);
    if (failed.length) {
      console.warn(`pushCfgFiles(${matchId}): ${failed.length} file(s) failed:`, failed);
    }
    await startServer(serverId);
    const server = await waitUntilReady(serverId);
    await loadMatch(serverId, configUrl, configAuth);

    const connect = connectHost(server);
    if (!connect) throw new Error('Server ready but no connectable host');

    await setServerState(supabaseAdmin, matchId, {
      server_state: 'live',
      dathost_server_id: serverId,
      connect_string: connect,
    });
    return { connect, serverId };
  } catch (err) {
    await setServerState(supabaseAdmin, matchId, { server_state: 'failed' }).catch(() => {});
    throw err;
  }
}

/**
 * Tear down the match server (reuse model → stop, never delete). Idempotent-safe.
 *
 * Because every match shares ONE persistent server (D2), an unconditional stop here would let one
 * match kill another match's live server. Pass `onlyIfOwnsServer` (used by the score-report
 * auto-teardown) to no-op unless THIS match is the current occupant — i.e. its `server_state` is
 * still active (`provisioning`/`live`/`tearing_down`) and its `dathost_server_id` matches. The
 * explicit teardown route omits the flag, since that's a deliberate operator stop.
 *
 * Goes through `stopSharedServer` — a scrim should never be active while a real match owns the
 * server, but this clears any `scrim_sessions` row defensively regardless.
 */
export async function teardownMatchServer(
  supabaseAdmin: SupabaseClient,
  matchId: number,
  opts: { onlyIfOwnsServer?: boolean } = {},
): Promise<void> {
  const serverId = dathostServerId();

  if (opts.onlyIfOwnsServer) {
    const { data } = await supabaseAdmin
      .from('matches')
      .select('server_state, dathost_server_id')
      .eq('id', matchId)
      .maybeSingle();
    const row = data as { server_state?: string | null; dathost_server_id?: string | null } | null;
    const active =
      row?.server_state === 'provisioning' ||
      row?.server_state === 'live' ||
      row?.server_state === 'tearing_down';
    const ownsServer = !row?.dathost_server_id || row.dathost_server_id === serverId;
    if (!active || !ownsServer) return; // this match isn't the live occupant — leave the server alone
  }

  await setServerState(supabaseAdmin, matchId, { server_state: 'tearing_down' }).catch(() => {});
  await stopSharedServer(supabaseAdmin, serverId);
  await setServerState(supabaseAdmin, matchId, {
    server_state: 'done',
    connect_string: null,
  });
}

export interface ServerStatusView {
  serverState: ServerState;
  connectString: string | null;
  serverStartedAt: string | null;
}

/**
 * Read a match's server-state, reconciling a stale `live` against real DatHost state (#135). After a
 * match ends the shared server auto-stops (`autostop`, 10 min idle) while the row can stay `live` —
 * so the panel keeps offering a dead connect link until the score is entered. Here, when the DB says
 * `live` but DatHost reports the server stopped, flip it to `done` (connect cleared) so the panel
 * stops presenting it as joinable.
 *
 * Only `live` is reconciled: `provisioning` is legitimately `on:false/booting` mid-boot, and we only
 * ever *downgrade* on a confirmed stop — a running server is left alone (concurrent-occupancy is
 * #134's problem, not this one). Best-effort: hosting-unconfigured or a DatHost error returns the DB
 * value unchanged so the panel never breaks.
 */
export async function getReconciledServerState(
  supabaseAdmin: SupabaseClient,
  matchId: number,
): Promise<ServerStatusView> {
  const { data } = await supabaseAdmin
    .from('matches')
    .select('server_state, connect_string, server_started_at, dathost_server_id')
    .eq('id', matchId)
    .maybeSingle();
  const row = (data ?? {}) as {
    server_state?: string | null;
    connect_string?: string | null;
    server_started_at?: string | null;
    dathost_server_id?: string | null;
  };
  let serverState = (row.server_state ?? 'idle') as ServerState;
  let connectString = row.connect_string ?? null;

  const serverId = process.env.DATHOST_SERVER_ID;
  const ownsServer = !row.dathost_server_id || row.dathost_server_id === serverId;
  if (serverState === 'live' && serverId && ownsServer) {
    try {
      const server = await getServer(serverId);
      if (!server.on && !server.booting) {
        await setServerState(supabaseAdmin, matchId, { server_state: 'done', connect_string: null });
        serverState = 'done';
        connectString = null;
      }
    } catch {
      /* DatHost unreachable — keep the DB value so the panel still renders */
    }
  }

  return { serverState, connectString, serverStartedAt: row.server_started_at ?? null };
}

export interface ActiveServerMatch {
  matchId: number;
  label: string;
  serverState: ServerState;
  connectString: string | null;
  serverStartedAt: string | null;
}

/**
 * The match currently holding the shared server (reconciled against real DatHost state), or `null` if
 * it's idle. For the admin server console (#134/#135) — the single-server model (D2) means at most
 * one occupant. Returns `null` when hosting isn't configured.
 */
export async function getActiveServerMatch(
  supabaseAdmin: SupabaseClient,
): Promise<ActiveServerMatch | null> {
  const serverId = process.env.DATHOST_SERVER_ID;
  if (!serverId) return null;
  const { data } = await supabaseAdmin
    .from('matches')
    .select('id, match_number, server_started_at, weeks(week_number, seasons(name))')
    .eq('dathost_server_id', serverId)
    .in('server_state', OCCUPYING_STATES as unknown as string[])
    .order('server_started_at', { ascending: false })
    .limit(1);
  const rows = (data ?? []) as unknown as {
    id: number;
    match_number: number | null;
    server_started_at: string | null;
    weeks: { week_number: number | null; seasons: { name: string | null } | null } | null;
  }[];
  const row = rows[0];
  if (!row) return null;

  // Reconcile so a server that already auto-stopped isn't shown as occupied.
  const reconciled = await getReconciledServerState(supabaseAdmin, row.id);
  if (!OCCUPYING_STATES.includes(reconciled.serverState)) return null;

  return {
    matchId: row.id,
    label: matchLabel({
      matchId: row.id,
      seasonName: row.weeks?.seasons?.name,
      weekNumber: row.weeks?.week_number,
      matchNumber: row.match_number,
    }),
    serverState: reconciled.serverState,
    connectString: reconciled.connectString,
    serverStartedAt: reconciled.serverStartedAt,
  };
}

export interface ServerOccupancy {
  active: ActiveServerMatch | null;
  playersOnline: number | null;
  occupied: boolean;
}

/**
 * Whether the shared server is "in use" for a raw admin action (start/stop/apply-config), combining
 * two signals: a DGLS match holding it (`active`, DB truth) OR live players present with no DGLS match
 * at all (`playersOnline`) — the latter catches someone using the server casually/manually outside the
 * match state machine, which `active` alone can't see. `server` is passed in (already fetched by the
 * caller) rather than fetched here, so callers that already have it don't pay for a second DatHost call.
 */
export async function getServerOccupancy(
  supabaseAdmin: SupabaseClient,
  server: DathostServer | null,
): Promise<ServerOccupancy> {
  const active = await getActiveServerMatch(supabaseAdmin);
  const playersOnline = server?.players_online ?? null;
  const occupied = active !== null || (playersOnline ?? 0) > 0;
  return { active, playersOnline, occupied };
}

/** Human-readable reason for a `server_occupied` refusal, for the 409 body / admin console prompt. */
export function occupancyMessage(occupancy: ServerOccupancy): string {
  if (occupancy.active) {
    return `Match ${occupancy.active.label} is currently ${occupancy.active.serverState} on this server.`;
  }
  return `${occupancy.playersOnline ?? 0} player(s) are currently on the server outside of a DGLS match.`;
}
