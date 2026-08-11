// DatHost REST API client — per-match lifecycle for the DGLS match server (Phase 4 of the
// DatHost + MatchZy initiative; see `dathost_handoff/`). Thin typed wrapper over the verified
// endpoints. Server-side only (uses HTTP Basic with the account API password) — never import into a
// client component.
//
// Lifecycle (composed by `launchServer` in dathost-lifecycle.ts):
//   applyConfigSet('golden') → startServer → waitUntilReady → loadMatch → (play) → stopServer
//
// We REUSE one persistent server (decision D2): teardown is `stopServer`, never delete. The server is
// reconfigured in the DatHost panel for recreational modes between matches, so the `golden` config set
// MUST be re-applied before every match to overwrite that drift. `duplicateServer`/`deleteServer`
// exist only as the documented fallback (concurrency overflow / golden-image rebuild).
//
// Env:
//   DATHOST_EMAIL, DATHOST_PASSWORD   HTTP Basic creds (account email + API password)
//   DATHOST_SERVER_ID                 the persistent DGLS match server id

import { isServerLive } from './util';

export const BASE = 'https://dathost.com/api/0.1';

/**
 * cs2_settings keys that are set per-match/per-apply (the picked workshop map), not part of any
 * config set's baseline — see `per_match_overrides` in the seeded golden settings.
 */
export const MAP_SELECTION_KEYS = new Set(['maps_source', 'workshop_collection_id', 'workshop_single_map_id']);

/**
 * The scalar PUT fields for one settings object — optionally `prefix`ed (`cs2_settings.` for that
 * block, bare for the top-level `server` block) and excluding any keys in `exclude` (map-selection
 * keys, set per-apply instead — see `applyConfigSet`). We intentionally only include scalar fields:
 * arrays (e.g. `metamod_plugins`) are preserved by DatHost across changes, so re-asserting them would
 * mean guessing array form-encoding for no benefit; `null` and any other non-primitive (a nested
 * object) have no defined PUT encoding here, and String()-ing them would silently send
 * "null"/"[object Object]" to the live server. `typeof null === 'object'`, so one check covers null,
 * arrays, and nested objects together. Exported for `scripts/dathost-golden-apply.ts`'s `--reassert`,
 * which pushes the same fields outside the app's own request path.
 */
export function buildScalarFields(
  settings: Record<string, unknown>,
  opts: { prefix?: string; exclude?: ReadonlySet<string>; onSkip?: (key: string) => void } = {},
): Record<string, string> {
  const { prefix = '', exclude, onSkip } = opts;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (exclude?.has(key)) continue;
    if (typeof value === 'object') {
      onSkip?.(key);
      continue;
    }
    fields[`${prefix}${key}`] = String(value);
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
  custom_domain: string | null;
  ports: { game: number; gotv: number | null } | null;
  match_id: string | null;
  cs2_settings: Record<string, unknown> | null;
  server_error: string | null;
  players_online: number | null;
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

export function authHeader(): string {
  const email = process.env.DATHOST_EMAIL;
  const password = process.env.DATHOST_PASSWORD;
  if (!email || !password) {
    throw new Error('DATHOST_EMAIL and DATHOST_PASSWORD must be set');
  }
  return 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64');
}

/** One authenticated DatHost request, returning the raw `Response` — shared by `call()` (JSON/text
 *  body) and `getFileResponse()` (binary body), which otherwise duplicate the same URL/auth-header
 *  construction, and exported for `dathost-config.ts`'s cfg-file push/diff reads and
 *  `scripts/dathost-golden-shared.ts`'s CLI-facing `api()` — the codebase's one place that builds a
 *  DatHost request, so a CLI script's `{status, text, json}` contract and this module's throw-on-
 *  non-2xx `call()` can't independently drift on the URL/auth/body-encoding underneath both. `body` is
 *  form-encoded from a plain record (the common case) or passed through as-is for a multipart upload
 *  (`pushCfgFiles`'s `FormData`) — `fetch` sets the multipart boundary header itself, so a `FormData`
 *  body must NOT get the urlencoded `Content-Type` the record case needs. Body consumption is left to
 *  the caller since JSON and binary reads can't share one. */
export async function request(
  method: string,
  path: string,
  body?: Record<string, string> | FormData,
): Promise<Response> {
  const encoded = body === undefined || body instanceof FormData ? body : new URLSearchParams(body);
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      ...(encoded instanceof URLSearchParams ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: encoded,
  });
}

/** One DatHost call. Throws `DathostError` on any non-2xx (with the parsed body for diagnostics). */
async function call(
  method: string,
  path: string,
  form?: Record<string, string>,
): Promise<unknown> {
  const res = await request(method, path, form);
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
 * PUT a resolved config set's full `server` + `cs2_settings` baseline (+ a pinned map) to overwrite
 * any recreational-mode drift. Callers resolve the set first (`resolveConfigSet` in
 * `dathost-config.ts`, Supabase-backed) so this stays a pure REST call with no DB dependency — the
 * same PUT whether it's real-match provisioning, the admin console's "Apply config set"/"Start", or
 * `/scrim/start`, so they can never disagree on which fields get re-asserted. The `server`-level
 * fields (`autostop`, `autostop_minutes`, …) apply to every caller intentionally, scrim included —
 * they're a shared-server idle/billing policy, not something that should vary by how the current boot
 * was started.
 *
 * `workshop_collection` mode does not behave reliably on the DGLS server (confirmed live) — every
 * apply must pin a single workshop map instead, so a resolved `mapWorkshopId` is required; this
 * throws rather than silently falling back to the broken collection mode.
 */
export async function applyConfigSet(
  id: string,
  set: { server: Record<string, unknown>; cs2Settings: Record<string, unknown> },
  opts: { mapWorkshopId?: string | null } = {},
): Promise<void> {
  if (!opts.mapWorkshopId) {
    throw new Error(
      'applyConfigSet requires a resolved map workshop id — the server can only be configured with a ' +
        'single pinned workshop map, never a collection.',
    );
  }
  const fields: Record<string, string> = {
    ...buildScalarFields(set.server),
    ...buildScalarFields(set.cs2Settings, { prefix: 'cs2_settings.', exclude: MAP_SELECTION_KEYS }),
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
 * Recent raw console/log lines (a rolling ~1000-line window), oldest first. The `/console` POST
 * above doesn't return a command's output — DatHost's console endpoints are fire-and-forget for
 * commands and read-only for the log — so this is the server's own stdout log, not an RCON response.
 * It's what `server-players.ts` derives the currently-connected roster from, since every connect/
 * disconnect/round event is already in here as `"name<userid><steamid><team>"`.
 */
export async function getConsoleLines(id: string): Promise<string[]> {
  const data = (await call('GET', `/game-servers/${id}/console`)) as { lines?: string[] } | null;
  return data?.lines ?? [];
}

/**
 * GET a file manager entry and apply `getFileBytes`'s "not there yet" semantics: `null` on a 404 (an
 * expected, pollable state for a demo still being flushed by GOTV, not a failure), thrown
 * `DathostError` on any other non-2xx.
 */
async function getFileResponse(id: string, remote: string): Promise<Response | null> {
  const res = await request('GET', `/game-servers/${id}/files/${remote}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new DathostError(`DatHost GET /game-servers/${id}/files/${remote} → ${res.status}`, res.status, null);
  }
  return res;
}

/**
 * Download a file's raw bytes from the server's file manager (same root `dathost-config.ts`'s cfg
 * push/diff uses, e.g. `cfg/server.cfg`). Binary-safe, unlike `dathost-config.ts`'s `getText` (which
 * reads the response as text — fine for cfg files, not for a `.dem`).
 */
export async function getFileBytes(id: string, remote: string): Promise<Buffer | null> {
  const res = await getFileResponse(id, remote);
  if (!res) return null;
  return Buffer.from(await res.arrayBuffer());
}

/** One entry from `listFiles()` — a file (or directory) on the server's local disk, per DatHost's
 *  file-manager listing. `size` is `null` when the listing itself omits it (distinct from a file that
 *  genuinely reports a `0` size) — `getFileSize()` treats either "no entry" or "entry with a `null`
 *  size" as unresolved, not as a real zero-byte reading. */
export interface DathostFile {
  path: string;
  size: number | null;
  deleted: boolean;
  /** Raw `modified_at` from the listing, undefined if the listing omitted it. DatHost doesn't
   *  document whether this is Unix seconds or milliseconds — see `parseModifiedAt()` in
   *  `dathost-retention.ts`, which resolves that by magnitude, for turning this into a `Date`. */
  modifiedAt: number | undefined;
}

/**
 * List files under `dir` (e.g. `MatchZy`) on the server's local disk, each with a `size` — this
 * listing endpoint reports it directly as JSON. That's distinct from (and more reliable than)
 * `getFileBytes`'s direct-download route, which reports neither a `Content-Length` header nor
 * `Content-Range`/Range support for a large or in-progress file — so a file's size can never be read
 * off that route's response, only off this listing (see the "DatHost API patterns" gotcha in
 * docs/cs2-stack-reference.md). `path` in each returned entry is relative to `dir`, not the full
 * remote path. A `dir` DatHost has no record of (never written to, e.g. before MatchZy has recorded
 * anything) resolves the same "not there yet" way a missing file does: an empty list, not a thrown
 * error.
 */
export async function listFiles(id: string, dir: string): Promise<DathostFile[]> {
  let data: unknown;
  try {
    data = await call('GET', `/game-servers/${id}/files?path=${encodeURIComponent(dir)}`);
  } catch (err) {
    if (err instanceof DathostError && err.status === 404) return [];
    throw err;
  }
  return (data as Array<{ path: string; size?: number; deleted?: boolean; modified_at?: number }>).map((f) => ({
    path: f.path,
    size: f.size ?? null,
    deleted: f.deleted ?? false,
    modifiedAt: f.modified_at,
  }));
}

/**
 * A single file's current size in bytes, via `listFiles()` on its containing directory rather than
 * `getFileBytes`/`getFileResponse`'s direct-download route (see `listFiles`'s doc comment, and the
 * "DatHost API patterns" gotcha in docs/cs2-stack-reference.md, for why that route can't answer this).
 * `null` if `remote` isn't in its directory's listing (not there yet), is marked `deleted`, or is
 * listed with no resolvable size yet — a pollable "not resolved yet" state, not a failure.
 */
export async function getFileSize(id: string, remote: string): Promise<number | null> {
  const slash = remote.lastIndexOf('/');
  const dir = slash === -1 ? '' : remote.slice(0, slash);
  const name = remote.slice(slash + 1);
  const files = await listFiles(id, dir);
  const match = files.find((f) => f.path === name && !f.deleted);
  return match?.size ?? null;
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

/**
 * `connect <ip:port>` host (host only, no `connect ` prefix). Prefers the numeric `raw_ip`/`ip` over
 * `custom_domain` — Steam's `steam://` URI handler is unreliable at resolving a hostname, while the
 * in-game `connect` console command resolves either fine. This is the single source of the connect
 * host — every consumer (per-match `connect_string`, the admin console) should go through this
 * function rather than reading `raw_ip`/`custom_domain` directly, so they can't drift apart again.
 */
export function connectHost(server: DathostServer): string | null {
  const host = server.raw_ip ?? server.ip ?? server.custom_domain;
  const port = server.ports?.game;
  if (!host || !port) return null;
  return `${host}:${port}`;
}

/** `setTimeout` as a promise. Exported for `fetchFromDathost.ts`'s own floor/backoff waits, which are
 *  plain delays rather than a `pollUntil` loop. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll `fn` until it returns a truthy result, or throw a `DathostError` after `timeoutMs`. Shared by
 * `waitUntilReady` below and `waitForConcurrentPull` (`src/lib/demo/fetchFromDathost.ts`, polling R2
 * for a concurrent pull to land) — both are "keep checking a resource until it's ready" loops that
 * would otherwise duplicate the same timeout/backoff shape.
 */
export async function pollUntil<T>(
  fn: () => Promise<T | null>,
  opts: { timeoutMs: number; intervalMs: number; timeoutMessage: string },
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() - start > opts.timeoutMs) {
      throw new DathostError(opts.timeoutMessage, 504, null);
    }
    await sleep(opts.intervalMs);
  }
}

/** Poll until the server reports running (`on && !booting`) with a connectable host, or time out. */
export async function waitUntilReady(
  id: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<DathostServer> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  return pollUntil(
    async () => {
      const server = await getServer(id);
      return isServerLive(server) && connectHost(server) ? server : null;
    },
    { timeoutMs, intervalMs: opts.intervalMs ?? 3_000, timeoutMessage: `Server ${id} not ready after ${Math.round(timeoutMs / 1000)}s` },
  );
}

// --- Fallback only (concurrency overflow / golden-image rebuild) — NOT the per-match path. ---

export async function duplicateServer(goldenId: string): Promise<DathostServer> {
  return (await call('POST', `/game-servers/${goldenId}/duplicate`)) as DathostServer;
}

export async function deleteServer(id: string): Promise<void> {
  await call('DELETE', `/game-servers/${id}`);
}
