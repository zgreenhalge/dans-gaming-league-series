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
} from './dathost';

export type ServerState = 'idle' | 'provisioning' | 'live' | 'tearing_down' | 'done' | 'failed';

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

/** Tear down the match server (reuse model → stop, never delete). Idempotent-safe. */
export async function teardownMatchServer(
  supabaseAdmin: SupabaseClient,
  matchId: number,
): Promise<void> {
  const serverId = dathostServerId();
  await setServerState(supabaseAdmin, matchId, { server_state: 'tearing_down' }).catch(() => {});
  await stopServer(serverId);
  await setServerState(supabaseAdmin, matchId, {
    server_state: 'done',
    connect_string: null,
  });
}
