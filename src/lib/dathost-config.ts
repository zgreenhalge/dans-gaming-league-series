// Server-side source of truth for the DGLS match server's *config files* and the golden-config diff.
// Split from `dathost.ts` (the lifecycle REST client) because this side is about the versioned
// `infra/matchzy/` config — the cfg files pushed to the server and the drift comparison against them.
// Shared by three call sites so the file list and the parse/compare rules never fork:
//   - provisioning (`pushCfgFiles` — reasserts the cfg files before every server boot),
//   - the admin console (`diffGoldenConfig` — read-only "compare to golden"),
//   - the CLI scripts (`scripts/dathost-golden-*.ts`, which render these same results in a terminal).
//
// Node runtime only (uses `node:fs` and HTTP Basic auth). Each cfg file is read through a literal
// `new URL(..., import.meta.url)` (see `CfgFile.url`) so the bundler traces exactly those files into
// the serverless function — a computed `fs` path would make Turbopack walk the whole directory.

import { readFileSync } from 'node:fs';
import { BASE, authHeader } from './dathost';
import goldenServerSettings from '../../infra/matchzy/golden-server-settings.json';

export interface CfgFile {
  /** Repo-relative path — used by the capture script to write live content back to the repo. */
  local: string;
  /** Path on the server, rooted at the DatHost file-manager root (includes `cfg/`). */
  remote: string;
  /**
   * Literal build-time URL to the file's content. It MUST be a literal `new URL(..., import.meta.url)`
   * so the bundler traces exactly this file into the function (a computed `fs` path makes Turbopack
   * pull in the whole directory and choke). `readCfgText` reads through this.
   */
  url: URL;
}

/**
 * The full set of cfg files that define match behavior — confirmed remote paths against the live API +
 * the DatHost files reference. `pushCfgFiles` reasserts all of them and `diffGoldenConfig` compares all
 * of them. `live_wingman_override.cfg` is the file MatchZy actually `exec`s at go-live (DGLS
 * engine-detects as Wingman), so it MUST be here or live_override.cfg's cvars never apply.
 */
export const CFG_FILES: CfgFile[] = [
  { local: 'infra/matchzy/cfg/MatchZy/config.cfg', remote: 'cfg/MatchZy/config.cfg', url: new URL('../../infra/matchzy/cfg/MatchZy/config.cfg', import.meta.url) },
  { local: 'infra/matchzy/cfg/server.cfg', remote: 'cfg/server.cfg', url: new URL('../../infra/matchzy/cfg/server.cfg', import.meta.url) },
  { local: 'infra/matchzy/cfg/gamemode_competitive2v2_server.cfg', remote: 'cfg/gamemode_competitive2v2_server.cfg', url: new URL('../../infra/matchzy/cfg/gamemode_competitive2v2_server.cfg', import.meta.url) },
  { local: 'infra/matchzy/cfg/MatchZy/live_override.cfg', remote: 'cfg/MatchZy/live_override.cfg', url: new URL('../../infra/matchzy/cfg/MatchZy/live_override.cfg', import.meta.url) },
  { local: 'infra/matchzy/cfg/MatchZy/live_wingman_override.cfg', remote: 'cfg/MatchZy/live_wingman_override.cfg', url: new URL('../../infra/matchzy/cfg/MatchZy/live_wingman_override.cfg', import.meta.url) },
];

/** Read a cfg file's content, or `null` if it can't be read (missing/untraced). */
function readCfgText(f: CfgFile): string | null {
  try {
    return readFileSync(f.url, 'utf8');
  } catch {
    return null;
  }
}

// --- Pushing cfg files to the server -----------------------------------------------------------

export interface CfgPushResult {
  remote: string;
  ok: boolean;
  /** HTTP status, or 0 if the local file was missing (never sent). */
  status: number;
}

/**
 * Push every tracked cfg file from `infra/matchzy/cfg/` to the live server's file manager, making the
 * repo the source of truth for the cfg dimension. Files take effect on the *next server boot* (they're
 * `exec`'d at boot / go-live), so callers must push before starting the server. Returns a per-file
 * result rather than throwing on a single failure, so a caller can log and decide.
 */
export async function pushCfgFiles(serverId: string): Promise<CfgPushResult[]> {
  const results: CfgPushResult[] = [];
  for (const f of CFG_FILES) {
    const { remote } = f;
    const text = readCfgText(f);
    if (text === null) {
      results.push({ remote, ok: false, status: 0 });
      continue;
    }
    const form = new FormData();
    form.append('file', new Blob([text]), remote.split('/').pop());
    const res = await fetch(`${BASE}/game-servers/${serverId}/files/${remote}`, {
      method: 'POST',
      headers: { Authorization: authHeader() },
      body: form,
    });
    results.push({ remote, ok: res.ok, status: res.status });
  }
  return results;
}

// --- Golden-config diff ------------------------------------------------------------------------

export type DiffStatus = 'match' | 'drift' | 'missing' | 'skipped';

export interface DiffRow {
  key: string;
  /** The versioned/golden value (or `(absent)` when only the live side has it). */
  local: string;
  /** The live server's value (or `(absent)`). */
  live: string;
  status: DiffStatus;
}

export interface CfgFileDiff {
  local: string;
  remote: string;
  rows: DiffRow[];
  /** Set when the live file couldn't be fetched (e.g. never uploaded) — rows will be empty. */
  error?: string;
}

export interface GoldenDiff {
  settings: DiffRow[];
  cfgFiles: CfgFileDiff[];
  /** True when nothing drifted or is missing (arrays/`skipped` don't count as drift). */
  clean: boolean;
}

/** Compare a flat golden object against the live one, one scalar key at a time. Arrays are reported
 *  as `skipped` (DatHost preserves them; their PUT encoding isn't re-asserted — see dathost.ts). */
function compareFlat(label: string, local: Record<string, unknown>, live: Record<string, unknown> | undefined): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const [key, localVal] of Object.entries(local)) {
    const fullKey = `${label}.${key}`;
    if (Array.isArray(localVal) || (localVal !== null && typeof localVal === 'object')) {
      rows.push({ key: fullKey, local: JSON.stringify(localVal), live: '(not comparable)', status: 'skipped' });
      continue;
    }
    const liveVal = live?.[key];
    if (liveVal === undefined) {
      rows.push({ key: fullKey, local: String(localVal), live: '(absent)', status: 'missing' });
    } else {
      const status: DiffStatus = String(liveVal) === String(localVal) ? 'match' : 'drift';
      rows.push({ key: fullKey, local: String(localVal), live: String(liveVal), status });
    }
  }
  return rows;
}

/**
 * Parse a MatchZy/CS2 cfg file into an ordered cvar → value map. Skips blank lines and full-line `//`
 * comments; strips a trailing `;`. Cvar name = first whitespace-separated token, value = the rest.
 * Duplicate keys (repeated `exec` lines) get a `[2]`, `[3]`… suffix so they don't collide.
 */
export function parseCfg(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    const spaceIdx = line.search(/\s/);
    const key = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).replace(/;$/, '');
    const value = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1).trim().replace(/;$/, '');
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    map.set(n === 1 ? key : `${key}[${n}]`, value);
  }
  return map;
}

/** Compare two parsed cfg files cvar-by-cvar (so comment/whitespace edits aren't noise). */
export function compareCfg(local: Map<string, string>, live: Map<string, string>): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const key of new Set([...local.keys(), ...live.keys()])) {
    const localVal = local.get(key);
    const liveVal = live.get(key);
    if (localVal === undefined) {
      rows.push({ key, local: '(absent)', live: liveVal!, status: 'missing' });
    } else if (liveVal === undefined) {
      rows.push({ key, local: localVal, live: '(absent)', status: 'missing' });
    } else {
      rows.push({ key, local: localVal, live: liveVal, status: localVal === liveVal ? 'match' : 'drift' });
    }
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  return rows;
}

async function getText(path: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: authHeader() } });
  return { status: res.status, text: await res.text() };
}

/**
 * Diff the versioned golden config (`infra/matchzy/`) against the live server — both the scalar
 * `server`/`cs2_settings` fields and every cfg file, cvar-by-cvar. Read-only; makes no changes.
 */
export async function diffGoldenConfig(serverId: string): Promise<GoldenDiff> {
  const golden = goldenServerSettings as { server?: Record<string, unknown>; cs2_settings?: Record<string, unknown> };

  const { status, text } = await getText(`/game-servers/${serverId}`);
  let live: Record<string, unknown> = {};
  try {
    live = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON error body — leave live empty so every field reports as missing */
  }
  if (status !== 200) {
    throw new Error(`Could not read live server (${status})`);
  }
  const liveCs2 = (live.cs2_settings ?? {}) as Record<string, unknown>;

  const settings = [
    ...compareFlat('server', golden.server ?? {}, live),
    ...compareFlat('cs2_settings', golden.cs2_settings ?? {}, liveCs2),
  ];

  const cfgFiles: CfgFileDiff[] = [];
  for (const f of CFG_FILES) {
    const { local, remote } = f;
    const text = readCfgText(f);
    if (text === null) {
      cfgFiles.push({ local, remote, rows: [], error: 'missing local file' });
      continue;
    }
    const fetched = await getText(`/game-servers/${serverId}/files/${remote}`);
    if (fetched.status !== 200) {
      cfgFiles.push({ local, remote, rows: [], error: `could not fetch (${fetched.status})` });
      continue;
    }
    const rows = compareCfg(parseCfg(text), parseCfg(fetched.text));
    cfgFiles.push({ local, remote, rows });
  }

  const settingsClean = settings.every((r) => r.status === 'match' || r.status === 'skipped');
  const cfgClean = cfgFiles.every((f) => !f.error && f.rows.every((r) => r.status === 'match'));
  return { settings, cfgFiles, clean: settingsClean && cfgClean };
}
