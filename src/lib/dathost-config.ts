// Server-side source of truth for DatHost *config sets* — settings + cfg files, held in Supabase
// (`config_sets`/`config_set_files`) so every config set, `golden` (the production baseline)
// included, is a single row: editable and diffable the same way regardless of which set it is. Split
// from `dathost.ts` (the lifecycle REST client, DB-free) because this side owns the config-set data
// model. Shared by three call sites so the file list and the parse/compare rules never fork:
//   - launching (`launchServer` in dathost-lifecycle.ts — reasserts a set's cfg files before boot),
//   - the admin console (`diffConfigSet` — read-only "compare to live"),
//   - the CLI scripts (`scripts/dathost-golden-*.ts`, which render these same results in a terminal).
//
// `infra/matchzy/` (the versioned settings JSON + cfg files) is no longer read live — it's the
// one-time seed input (`scripts/seed-config-set.ts`) and a disaster-recovery snapshot only.

import type { SupabaseClient } from '@supabase/supabase-js';
import { request } from './dathost';

export interface ConfigSetOption {
  key: string;
  label: string;
}

export interface ResolvedConfigSet {
  key: string;
  label: string;
  server: Record<string, unknown>;
  cs2Settings: Record<string, unknown>;
  cfgFiles: { remote: string; content: string }[];
}

interface ConfigSetRow {
  id: number;
  key: string;
  label: string;
  server_settings: Record<string, unknown>;
  cs2_settings: Record<string, unknown>;
}

/** For UI pickers (e.g. the admin server console) — key/label pairs, insertion order. */
export async function listConfigSets(supabaseAdmin: SupabaseClient): Promise<ConfigSetOption[]> {
  const { data, error } = await supabaseAdmin.from('config_sets').select('key, label').order('id');
  if (error) throw new Error(`Could not list config sets: ${error.message}`);
  return (data ?? []) as ConfigSetOption[];
}

/** One config set's full settings + cfg files, by key. Throws if the key doesn't exist. */
export async function resolveConfigSet(supabaseAdmin: SupabaseClient, key: string): Promise<ResolvedConfigSet> {
  const { data: set, error: setErr } = await supabaseAdmin
    .from('config_sets')
    .select('id, key, label, server_settings, cs2_settings')
    .eq('key', key)
    .maybeSingle();
  if (setErr) throw new Error(`Could not load config set "${key}": ${setErr.message}`);
  if (!set) throw new Error(`Unknown config set "${key}"`);
  const row = set as ConfigSetRow;

  const { data: files, error: filesErr } = await supabaseAdmin
    .from('config_set_files')
    .select('remote_path, content')
    .eq('config_set_id', row.id);
  if (filesErr) throw new Error(`Could not load files for config set "${key}": ${filesErr.message}`);

  return {
    key: row.key,
    label: row.label,
    server: row.server_settings ?? {},
    cs2Settings: row.cs2_settings ?? {},
    cfgFiles: ((files ?? []) as { remote_path: string; content: string }[]).map((f) => ({
      remote: f.remote_path,
      content: f.content,
    })),
  };
}

// --- Pushing cfg files to the server -----------------------------------------------------------

export interface CfgPushResult {
  remote: string;
  ok: boolean;
  /** HTTP status, or 0 if the local file was missing (never sent). */
  status: number;
}

/**
 * Push a config set's cfg files to the live server's file manager. Files take effect on the *next
 * server boot* (they're `exec`'d at boot / go-live), so callers must push before starting the server.
 * Returns a per-file result rather than throwing on a single failure, so a caller can log and decide.
 */
export async function pushCfgFiles(serverId: string, files: { remote: string; content: string }[]): Promise<CfgPushResult[]> {
  const results: CfgPushResult[] = [];
  for (const { remote, content } of files) {
    const form = new FormData();
    form.append('file', new Blob([content]), remote.split('/').pop());
    const res = await request('POST', `/game-servers/${serverId}/files/${remote}`, form);
    results.push({ remote, ok: res.ok, status: res.status });
  }
  return results;
}

// --- Config-set diff ----------------------------------------------------------------------------

export type DiffStatus = 'match' | 'drift' | 'missing' | 'skipped';

export interface DiffRow {
  key: string;
  /** The config set's value (or `(absent)` when only the live side has it). */
  local: string;
  /** The live server's value (or `(absent)`). */
  live: string;
  status: DiffStatus;
}

export interface CfgFileDiff {
  remote: string;
  rows: DiffRow[];
  /** Set when the live file couldn't be fetched (e.g. never uploaded) — rows will be empty. */
  error?: string;
}

export interface ConfigSetDiff {
  settings: DiffRow[];
  cfgFiles: CfgFileDiff[];
  /** True when nothing drifted or is missing (arrays/`skipped` don't count as drift). */
  clean: boolean;
}

/** Compare a flat config-set object against the live one, one scalar key at a time. Arrays are
 *  reported as `skipped` (DatHost preserves them; their PUT encoding isn't re-asserted — see
 *  dathost.ts). */
export function compareFlat(label: string, local: Record<string, unknown>, live: Record<string, unknown> | undefined): DiffRow[] {
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
  const res = await request('GET', path);
  return { status: res.status, text: await res.text() };
}

/**
 * Diff a config set (by key) against the live server — both the scalar `server`/`cs2_settings`
 * fields and every cfg file, cvar-by-cvar. Read-only; makes no changes.
 */
export async function diffConfigSet(supabaseAdmin: SupabaseClient, serverId: string, key: string): Promise<ConfigSetDiff> {
  const set = await resolveConfigSet(supabaseAdmin, key);

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
    ...compareFlat('server', set.server, live),
    ...compareFlat('cs2_settings', set.cs2Settings, liveCs2),
  ];

  const cfgFiles: CfgFileDiff[] = [];
  for (const f of set.cfgFiles) {
    const fetched = await getText(`/game-servers/${serverId}/files/${f.remote}`);
    if (fetched.status !== 200) {
      cfgFiles.push({ remote: f.remote, rows: [], error: `could not fetch (${fetched.status})` });
      continue;
    }
    const rows = compareCfg(parseCfg(f.content), parseCfg(fetched.text));
    cfgFiles.push({ remote: f.remote, rows });
  }

  const settingsClean = settings.every((r) => r.status === 'match' || r.status === 'skipped');
  const cfgClean = cfgFiles.every((f) => !f.error && f.rows.every((r) => r.status === 'match'));
  return { settings, cfgFiles, clean: settingsClean && cfgClean };
}
