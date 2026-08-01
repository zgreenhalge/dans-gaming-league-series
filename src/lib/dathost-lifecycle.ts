// Per-match DatHost server lifecycle orchestration (Phase 4). Composes the `dathost.ts` client with
// the match's data and persists a small server-state machine on the `match_server_state` table (one
// row per match, `match_id` FK to `matches`) — kept off the core `matches` row since this is
// transient orchestration state, not match data (#288).
//
//   provision: provisioning → apply golden settings → start → wait ready → loadmatch → live
//   teardown:  stop → idle
//
// Server-side only. `match_server_state` columns: server_state text, dathost_server_id text,
// connect_string text, server_started_at timestamptz, teardown_at timestamptz. No row means `idle`.
//
// Reuse model (D2): teardown stops the persistent server; it never deletes it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { mapSlug } from './maps';
import { matchLabel, isPlayedScore } from './util';
import { SCHEDULE_COLLISION_WINDOW_MS } from './schedule';
import {
  dathostServerId,
  applyConfigSet,
  startServer,
  stopServer,
  waitUntilReady,
  loadMatch,
  connectHost,
  workshopIdFromUrl,
  getServer,
  runConsole,
  type DathostServer,
} from './dathost';
import { releaseScrimSession } from './scrim-session';
import { resolveConfigSet, pushCfgFiles } from './dathost-config';
import { recordOpsError, clearOpsError } from './ops-errors';

/** The "friendly" cvars — only asserted when the launch-time "friendly" toggle is on. */
export const FRIENDLY_CVARS = ['mp_autokick 0', 'mp_drop_knife_enable 1', 'mp_forcecamera 0', 'mp_shoot_dropped_grenades true'];

/**
 * Cvars asserted right after boot for any launch with no roster loaded (scrim, or an admin-console
 * launch that doesn't follow up with `loadMatch`): no knife round (players pick their own side via
 * `.ct`/`.t`/`.spec`), `matchzy_playout_enabled_default` and `FRIENDLY_CVARS` from their respective
 * launch-time toggles, and `mp_warmup_pausetimer`/`matchzy_minimum_ready_required 0` unconditionally —
 * the golden league config's `matchzy_minimum_ready_required 4` assumes a full 2v2 roster, which
 * doesn't hold with no roster loaded, so it's overridden here (`0` = ready requires everyone currently
 * connected, not a fixed headcount) rather than in the shared config set real matches also use.
 */
export function pugModeCvarLine(opts: { playout: boolean; friendly: boolean }): string {
  const cvars = [
    'matchzy_knife_enabled_default 0',
    `matchzy_playout_enabled_default ${opts.playout ? 1 : 0}`,
    'mp_warmup_pausetimer 1',
    'matchzy_minimum_ready_required 0',
    ...(opts.friendly ? FRIENDLY_CVARS : []),
  ];
  return cvars.join('; ');
}

export interface LaunchResult {
  server: DathostServer;
  connect: string;
}

/**
 * Resolve a config set, push its cfg files, boot the server, and optionally assert extra cvars once
 * ready — the one place "apply + push + boot + cvars" is composed, shared by real-match provisioning
 * (`provisionMatchServer`, `configSetKey: 'golden'`, no `extraCvars` — `loadMatch` runs after instead)
 * and the admin/scrim launch routes (their own config-set pick + `pugModeCvarLine`-derived
 * `extraCvars`). A per-file cfg-push failure is logged, not fatal.
 */
export async function launchServer(
  supabaseAdmin: SupabaseClient,
  serverId: string,
  opts: { configSetKey: string; mapWorkshopId: string | null; extraCvars?: string },
): Promise<LaunchResult> {
  const set = await resolveConfigSet(supabaseAdmin, opts.configSetKey);
  await applyConfigSet(serverId, { server: set.server, cs2Settings: set.cs2Settings }, { mapWorkshopId: opts.mapWorkshopId });

  const pushed = await pushCfgFiles(serverId, set.cfgFiles);
  const failed = pushed.filter((p) => !p.ok);
  if (failed.length) {
    console.warn(`launchServer(${opts.configSetKey}): ${failed.length} cfg file(s) failed:`, failed);
  }

  await startServer(serverId);
  const server = await waitUntilReady(serverId);
  if (opts.extraCvars) await runConsole(serverId, opts.extraCvars);

  const connect = connectHost(server);
  if (!connect) throw new Error('Server ready but no connectable host');
  return { server, connect };
}

/** Automatic teardown (map_result, score-write) waits this long before actually stopping the shared
 *  server, so players get to see the post-match scoreboard instead of an instant disconnect. Manual
 *  teardown (admin console "Tear down") is unaffected — that's a deliberate operator stop-now. */
export const AUTO_TEARDOWN_DELAY_MS = 2.5 * 60 * 1000;

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
    .from('match_server_state')
    .select('match_id')
    .eq('dathost_server_id', serverId)
    .in('server_state', OCCUPYING_STATES as unknown as string[])
    .neq('match_id', exceptMatchId)
    .limit(1);
  const rows = (data ?? []) as { match_id: number }[];
  return rows.length ? rows[0].match_id : null;
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

/** Shape of a `match_server_state` row. Shared by every read/write below instead of each call site
 *  re-declaring its own subset as an inline cast. */
export interface MatchServerStateRow {
  server_state: ServerState;
  dathost_server_id: string | null;
  connect_string: string | null;
  server_started_at: string | null;
  teardown_at: string | null;
}

const SERVER_STATE_COLUMNS = 'server_state, connect_string, server_started_at, dathost_server_id, teardown_at';

/** Raw read of a match's `match_server_state` row (no DatHost reconciliation) — `null` if the match
 *  has never been provisioned (`idle`). Shared by every caller that needs the DB value as-is (e.g. the
 *  veto route's busy-check, which deliberately skips `getReconciledServerState`'s DatHost round-trip
 *  on this latency-sensitive path). */
export async function fetchServerStateRow(
  supabaseAdmin: SupabaseClient,
  matchId: number,
): Promise<MatchServerStateRow | null> {
  const { data } = await supabaseAdmin
    .from('match_server_state')
    .select(SERVER_STATE_COLUMNS)
    .eq('match_id', matchId)
    .maybeSingle();
  return data as MatchServerStateRow | null;
}

async function setServerState(
  supabaseAdmin: SupabaseClient,
  matchId: number,
  fields: { server_state: ServerState } & Partial<Omit<MatchServerStateRow, 'server_state'>>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('match_server_state')
    .upsert({ match_id: matchId, ...fields }, { onConflict: 'match_id' });
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
    const { connect } = await launchServer(supabaseAdmin, serverId, { configSetKey: 'golden', mapWorkshopId });
    await loadMatch(serverId, configUrl, configAuth);

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

/** `afterBestEffort`'s `onError` for a deferred `provisionMatchServer` call: a `ServerBusyError` is
 *  the expected race-loser (another match claimed the server between the check and now) and just
 *  warns; anything else is a real provisioning failure. `context` distinguishes the caller in the log
 *  line (e.g. `'provision'` vs `'auto-provision'`). */
export function provisionErrorHandler(context: string, matchId: number): (err: unknown) => void {
  return (err) => {
    if (err instanceof ServerBusyError) {
      console.warn(`${context}(${matchId}) skipped: ${err.message}`);
    } else {
      console.error(`provisionMatchServer(${matchId}) failed:`, err);
    }
  };
}

/**
 * Tear down the match server (reuse model → stop, never delete). Idempotent-safe.
 *
 * Because every match shares ONE persistent server (D2), an unconditional stop here would let one
 * match kill another match's live server. Pass `onlyIfOwnsServer` (used by the score-report and
 * map_result auto-teardown) to no-op unless THIS match is the current occupant — i.e. its
 * `server_state` is still active (`provisioning`/`live`/`tearing_down`) and its `dathost_server_id`
 * matches. The explicit teardown route omits the flag, since that's a deliberate operator stop.
 *
 * Pass `delayMs` to schedule the stop instead of running it inline: the row moves to `tearing_down`
 * with `teardown_at` set, and the actual `stop` call happens the next time `getReconciledServerState`
 * is read (match page, admin server console, or its 2s poll) once `teardown_at` has passed — the
 * automatic paths use this so players see the post-match scoreboard instead of an instant disconnect.
 * Omit it (the explicit teardown route does) for an immediate stop.
 *
 * Goes through `stopSharedServer` — a scrim should never be active while a real match owns the
 * server, but this clears any `scrim_sessions` row defensively regardless.
 */
export async function teardownMatchServer(
  supabaseAdmin: SupabaseClient,
  matchId: number,
  opts: { onlyIfOwnsServer?: boolean; delayMs?: number } = {},
): Promise<void> {
  const serverId = dathostServerId();

  if (opts.onlyIfOwnsServer) {
    const row = await fetchServerStateRow(supabaseAdmin, matchId);
    const active =
      row?.server_state === 'provisioning' ||
      row?.server_state === 'live' ||
      row?.server_state === 'tearing_down';
    const ownsServer = !row?.dathost_server_id || row.dathost_server_id === serverId;
    if (!active || !ownsServer) return; // this match isn't the live occupant — leave the server alone
  }

  if (opts.delayMs) {
    // Unlike the marker write below, this IS the whole action for the delayed path (no immediate
    // stopSharedServer follows it) — a failure here must propagate to the caller so its own
    // recordOpsError sees it, not get silently swallowed.
    await setServerState(supabaseAdmin, matchId, {
      server_state: 'tearing_down',
      teardown_at: new Date(Date.now() + opts.delayMs).toISOString(),
    });
    return;
  }

  await setServerState(supabaseAdmin, matchId, { server_state: 'tearing_down' }).catch(() => {});
  await stopSharedServer(supabaseAdmin, serverId);
  await setServerState(supabaseAdmin, matchId, {
    server_state: 'done',
    connect_string: null,
    teardown_at: null,
  });
}

export interface ServerStatusView {
  serverState: ServerState;
  connectString: string | null;
  serverStartedAt: string | null;
}

/** Downgrade a match's server row to `done` (connect cleared) — the shared tail of both branches in
 *  `getReconciledServerState` below. */
async function downgradeToDone(
  supabaseAdmin: SupabaseClient,
  matchId: number,
  fields: { teardown_at?: null } = {},
): Promise<void> {
  await setServerState(supabaseAdmin, matchId, { server_state: 'done', connect_string: null, ...fields });
}

/**
 * Execute a `tearing_down` row's scheduled stop once its `teardown_at` has passed — the actual `stop`
 * call for the delayed-teardown paths (map_result, score-write; see `teardownMatchServer`'s
 * `delayMs`). A no-op, DatHost-untouched read when the delay hasn't elapsed yet: this fires on every
 * read of `getReconciledServerState`, including the admin console's 2s poll for the whole grace
 * period, and `teardown_at` already answers "nothing to do yet" without a round-trip. That means a
 * manual admin stop or DatHost's own autostop racing ahead during the grace window isn't detected
 * until `teardown_at` passes — accepted, since both `stopServer` and `teardownMatchServer` are
 * idempotent, so the deferred attempt below still lands cleanly against an already-stopped server once
 * due. A null `teardown_at` (the explicit, non-delayed teardown route entering `tearing_down` without
 * ever setting one) counts as due immediately — it means an immediate stop was requested and its own
 * `stopSharedServer` call failed, so this is the retry path for that stuck case, not "nothing
 * scheduled". Returns whether it downgraded the row to `done`.
 */
async function runDueTeardown(
  supabaseAdmin: SupabaseClient,
  matchId: number,
  serverId: string,
  teardownAt: string | null,
): Promise<boolean> {
  if (teardownAt != null && Date.parse(teardownAt) > Date.now()) return false;
  try {
    await stopSharedServer(supabaseAdmin, serverId);
    await downgradeToDone(supabaseAdmin, matchId, { teardown_at: null });
    await clearOpsError(supabaseAdmin, 'match', matchId, 'server_teardown');
    return true;
  } catch (err) {
    await recordOpsError(supabaseAdmin, 'match', matchId, 'server_teardown', `Server teardown failed: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Read a match's server-state, reconciling it against real DatHost state (#135). Two cases:
 *
 * - `tearing_down`: `runDueTeardown` above executes the scheduled stop once `teardown_at` has passed
 *   — see its own doc comment for what "due" means and why this stays cheap while it isn't.
 * - `live` but DatHost reports the server already stopped (`autostop`, 3 min idle): the shared server
 *   auto-stops while the row can stay `live` if nothing scheduled a teardown — so the panel keeps
 *   offering a dead connect link. Flip it to `done` (connect cleared) so the panel stops presenting it
 *   as joinable.
 *
 * `provisioning` is never reconciled here — it's legitimately `on:false/booting` mid-boot — and this
 * only ever *downgrades* toward `done`, never the reverse (concurrent-occupancy is #134's problem, not
 * this one). Best-effort throughout: hosting-unconfigured or a DatHost error returns the DB value
 * unchanged so the panel never breaks, and a due teardown that fails to actually stop stays
 * `tearing_down` for the next read to retry (DatHost's own autostop is the ultimate backstop).
 *
 * Pass `preFetchedRow` when the caller already has the match's `match_server_state` row (e.g.
 * `getActiveServerMatch`, which selects it to find the occupant in the first place) so this doesn't
 * re-query the same row it was just handed.
 */
export async function getReconciledServerState(
  supabaseAdmin: SupabaseClient,
  matchId: number,
  preFetchedRow?: MatchServerStateRow | null,
): Promise<ServerStatusView> {
  const row = preFetchedRow !== undefined ? preFetchedRow : await fetchServerStateRow(supabaseAdmin, matchId);
  let serverState = row?.server_state ?? 'idle';
  let connectString = row?.connect_string ?? null;

  const serverId = process.env.DATHOST_SERVER_ID;
  const ownsServer = !row?.dathost_server_id || row.dathost_server_id === serverId;

  if (serverState === 'tearing_down' && serverId && ownsServer) {
    if (await runDueTeardown(supabaseAdmin, matchId, serverId, row?.teardown_at ?? null)) {
      serverState = 'done';
      connectString = null;
    }
  } else if (serverState === 'live' && serverId && ownsServer) {
    try {
      const server = await getServer(serverId);
      // Confirmed stopped only — NOT `!isServerLive(server)` (`!on || booting`), which would also
      // fire mid-boot (`on: true, booting: true`, e.g. another process restarting the shared server)
      // and wrongly downgrade a match that's still actually up.
      if (!server.on && !server.booting) {
        await downgradeToDone(supabaseAdmin, matchId);
        serverState = 'done';
        connectString = null;
      }
    } catch {
      /* DatHost unreachable — keep the DB value so the panel still renders */
    }
  }

  return { serverState, connectString, serverStartedAt: row?.server_started_at ?? null };
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
    .from('match_server_state')
    .select(`match_id, ${SERVER_STATE_COLUMNS}, matches(match_number, weeks(week_number, seasons(name)))`)
    .eq('dathost_server_id', serverId)
    .in('server_state', OCCUPYING_STATES as unknown as string[])
    .order('server_started_at', { ascending: false })
    .limit(1);
  const rows = (data ?? []) as unknown as (MatchServerStateRow & {
    match_id: number;
    matches: {
      match_number: number | null;
      weeks: { week_number: number | null; seasons: { name: string | null } | null } | null;
    } | null;
  })[];
  const row = rows[0];
  if (!row) return null;

  // Already fetched above — reconcile against it directly instead of re-querying the same row.
  const reconciled = await getReconciledServerState(supabaseAdmin, row.match_id, row);
  if (!OCCUPYING_STATES.includes(reconciled.serverState)) return null;

  return {
    matchId: row.match_id,
    label: matchLabel({
      matchId: row.match_id,
      seasonName: row.matches?.weeks?.seasons?.name,
      weekNumber: row.matches?.weeks?.week_number,
      matchNumber: row.matches?.match_number ?? null,
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
