// DatHost REST API client — per-match lifecycle for the DGLS match server (Phase 4 of the
// DatHost + MatchZy initiative; see `dathost_handoff/`). Thin typed wrapper over the verified
// endpoints. Server-side only (uses HTTP Basic with the account API password) — never import into a
// client component.
//
// Lifecycle (every endpoint verified live 2026-06-29):
//   applyGoldenSettings → startServer → waitUntilReady → loadMatch → (play) → stopServer
//
// We REUSE one persistent server (decision D2): teardown is `stopServer`, never delete. The server is
// reconfigured in the DatHost panel for recreational modes between matches, so `applyGoldenSettings`
// MUST run before every match to overwrite that drift. `duplicateServer`/`deleteServer` exist only as
// the documented fallback (concurrency overflow / golden-image rebuild).
//
// Env:
//   DATHOST_EMAIL, DATHOST_PASSWORD   HTTP Basic creds (account email + API password)
//   DATHOST_SERVER_ID                 the persistent DGLS match server id

import goldenServerSettings from '../../infra/matchzy/golden-server-settings.json';

const BASE = 'https://dathost.com/api/0.1';

/**
 * cs2_settings keys that are set per-match at provision time (the picked workshop map), not part of
 * the static golden baseline — see `per_match_overrides` in golden-server-settings.json.
 */
const MAP_SELECTION_KEYS = new Set(['maps_source', 'workshop_collection_id', 'workshop_single_map_id']);

/**
 * The scalar `cs2_settings` we re-assert before every match to undo recreational-mode drift, read
 * from `infra/matchzy/golden-server-settings.json` (the canonical, version-controlled snapshot) so
 * this file can't drift out of sync with it. We intentionally only PUT scalar fields —
 * `metamod_plugins` (an array) is preserved by DatHost across game-mode changes, so re-asserting it
 * would mean guessing array form-encoding for no benefit. Map-selection keys are excluded here and
 * set per-match instead, see `applyGoldenSettings`.
 */
function buildGoldenCs2Fields(): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(goldenServerSettings.cs2_settings)) {
    if (Array.isArray(value) || MAP_SELECTION_KEYS.has(key)) continue;
    fields[`cs2_settings.${key}`] = String(value);
  }
  return fields;
}

export interface DathostServer {
  id: string;
  name: string;
  on: boolean;
  booting: boolean;
  ip: string | null;
  raw_ip: string | null;
  ports: { game: number; gotv: number | null } | null;
  match_id: string | null;
  cs2_settings: Record<string, unknown> | null;
  server_error: string | null;
}

export class DathostError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'DathostError';
  }
}

function authHeader(): string {
  const email = process.env.DATHOST_EMAIL;
  const password = process.env.DATHOST_PASSWORD;
  if (!email || !password) {
    throw new Error('DATHOST_EMAIL and DATHOST_PASSWORD must be set');
  }
  return 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64');
}

/** One DatHost call. Throws `DathostError` on any non-2xx (with the parsed body for diagnostics). */
async function call(
  method: string,
  path: string,
  form?: Record<string, string>,
): Promise<unknown> {
  const body = form ? new URLSearchParams(form) : undefined;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (e.g. an HTML error page) — keep the raw text */
  }
  if (!res.ok) {
    const snippet = typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data);
    throw new DathostError(`DatHost ${method} ${path} → ${res.status}: ${snippet}`, res.status, data);
  }
  return data;
}

/** The configured persistent DGLS match server id, or throw if unset. */
export function dathostServerId(): string {
  const id = process.env.DATHOST_SERVER_ID;
  if (!id) throw new Error('DATHOST_SERVER_ID must be set');
  return id;
}

/** Extract the Steam workshop id from a `maps.workshop_url` (`…?id=<ID>`). `null` if not present. */
export function workshopIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?&]id=(\d+)/);
  return m ? m[1] : null;
}

export async function getServer(id: string): Promise<DathostServer> {
  return (await call('GET', `/game-servers/${id}`)) as DathostServer;
}

export async function startServer(id: string): Promise<void> {
  await call('POST', `/game-servers/${id}/start`);
}

/** Teardown for the reuse model — stop, never delete. */
export async function stopServer(id: string): Promise<void> {
  await call('POST', `/game-servers/${id}/stop`);
}

/**
 * PUT golden `cs2_settings` (+ the picked map) to overwrite any recreational-mode drift.
 *
 * `workshop_collection` mode does not behave reliably on the DGLS server (confirmed live) — every
 * provision must pin a single workshop map instead, so a resolved `mapWorkshopId` is required. Callers
 * (`provisionMatchServer`) must resolve the match's picked map before calling this; if that's not yet
 * possible (e.g. a manual provision before veto completes), this throws rather than silently falling
 * back to the broken collection mode.
 */
export async function applyGoldenSettings(
  id: string,
  opts: { mapWorkshopId?: string | null } = {},
): Promise<void> {
  if (!opts.mapWorkshopId) {
    throw new Error(
      'applyGoldenSettings requires a resolved map workshop id — the match must have a picked map ' +
        '(with a maps.workshop_url) before the server can be provisioned.',
    );
  }
  const fields: Record<string, string> = {
    ...buildGoldenCs2Fields(),
    'cs2_settings.maps_source': 'workshop_single_map',
    'cs2_settings.workshop_single_map_id': opts.mapWorkshopId,
  };
  await call('PUT', `/game-servers/${id}`, fields);
}

/** Issue a console/RCON command on the server. */
export async function runConsole(id: string, line: string): Promise<void> {
  await call('POST', `/game-servers/${id}/console`, { line });
}

/**
 * Load a per-match MatchZy config. `urlOrCommand` is either an authenticated config URL (→
 * `matchzy_loadmatch_url <url>`) or, if it contains a space, a full `matchzy_*` console line.
 */
export async function loadMatch(
  id: string,
  url: string,
  auth?: { headerKey: string; headerValue: string },
): Promise<void> {
  const line = auth
    ? `matchzy_loadmatch_url "${url}" "${auth.headerKey}" "${auth.headerValue}"`
    : `matchzy_loadmatch_url "${url}"`;
  await runConsole(id, line);
}

/** `connect <ip:port>` host (host only, no `connect ` prefix). Prefers raw IP over the hostname. */
export function connectHost(server: DathostServer): string | null {
  const host = server.raw_ip ?? server.ip;
  const port = server.ports?.game;
  if (!host || !port) return null;
  return `${host}:${port}`;
}

/** Poll until the server reports running (`on && !booting`) with a connectable host, or time out. */
export async function waitUntilReady(
  id: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<DathostServer> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const start = Date.now();
  for (;;) {
    const server = await getServer(id);
    if (server.on && !server.booting && connectHost(server)) return server;
    if (Date.now() - start > timeoutMs) {
      throw new DathostError(`Server ${id} not ready after ${Math.round(timeoutMs / 1000)}s`, 504, server);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// --- Fallback only (concurrency overflow / golden-image rebuild) — NOT the per-match path. ---

export async function duplicateServer(goldenId: string): Promise<DathostServer> {
  return (await call('POST', `/game-servers/${goldenId}/duplicate`)) as DathostServer;
}

export async function deleteServer(id: string): Promise<void> {
  await call('DELETE', `/game-servers/${id}`);
}
