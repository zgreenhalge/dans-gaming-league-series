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
} from './dathost';

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
  await stopServer(serverId);
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
