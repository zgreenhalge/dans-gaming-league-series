// Diff the versioned golden DatHost config (infra/matchzy/) against what's actually live on the
// DGLS match server. Read-only — makes no changes. See infra/matchzy/README.md for what "golden"
// means and why it can drift (the server is reconfigured in the DatHost panel for recreational
// modes between matches).
//
//   set -a; . ./.env.local; set +a
//   tsx scripts/dathost-golden-diff.ts [serverId]
//
// serverId defaults to DATHOST_SERVER_ID. Exits 0 if everything matches, 1 if any drift is found
// (settings or cfg files), 2 on a hard error (auth, network, missing local file).
//
// cfg file paths are rooted at the DatHost file-manager root (confirmed against the live API +
// https://dathost.readme.io/reference/get_game_server_files_item), so `csgo/cfg/server.cfg` is
// fetched as `cfg/server.cfg`, not `server.cfg`. If a file still 404s (renamed, never uploaded,
// etc.), this script lists whatever *is* under `cfg/` on the server so you can either point it at
// the right path or paste the content in by hand — it never guesses at a result.
//
// cfg files are compared cvar-by-cvar (not as a raw text diff), so comment/whitespace-only edits
// don't show up as noise and every result renders as one name/old/new table per file.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, GOLDEN_JSON_PATH, CFG_FILES, api } from './dathost-golden-shared';

const COLOR = process.stderr.isTTY;
const c = {
  bold: (s: string) => (COLOR ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (COLOR ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (COLOR ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (COLOR ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (COLOR ? `\x1b[33m${s}\x1b[0m` : s),
};

function heading(title: string) {
  console.error('');
  console.error(c.bold(title));
  console.error(c.dim('─'.repeat(Math.max(title.length, 40))));
}

function loadGolden(): { server: Record<string, unknown>; cs2_settings: Record<string, unknown> } {
  if (!existsSync(GOLDEN_JSON_PATH)) {
    console.error(c.red(`✖ missing ${GOLDEN_JSON_PATH}`));
    process.exit(2);
  }
  const parsed = JSON.parse(readFileSync(GOLDEN_JSON_PATH, 'utf8'));
  return { server: parsed.server ?? {}, cs2_settings: parsed.cs2_settings ?? {} };
}

type Row = { key: string; oldVal: string; newVal: string; status: 'match' | 'drift' | 'missing' | 'skipped' };

function statusGlyph(status: Row['status']): string {
  switch (status) {
    case 'match':
      return c.green('✓');
    case 'drift':
      return c.red('✗');
    case 'missing':
      return c.yellow('?');
    case 'skipped':
      return c.dim('~');
  }
}

/** Print a name / old / new table, right-padded to align columns. Empty rows -> nothing to show. */
function printTable(rows: Row[], oldLabel: string, newLabel: string) {
  if (rows.length === 0) return;
  const keyW = Math.max(...rows.map((r) => r.key.length), 3);
  const oldW = Math.max(...rows.map((r) => r.oldVal.length), oldLabel.length);
  console.error(`    ${' '.padEnd(keyW)}  ${oldLabel.padEnd(oldW)}  ${newLabel}`);
  for (const row of rows) {
    console.error(`  ${statusGlyph(row.status)} ${row.key.padEnd(keyW)}  ${row.oldVal.padEnd(oldW)}  ${row.newVal}`);
  }
}

function compareFlat(label: string, local: Record<string, unknown>, live: Record<string, unknown> | undefined): Row[] {
  const rows: Row[] = [];
  for (const [key, localVal] of Object.entries(local)) {
    const fullKey = `${label}.${key}`;
    if (Array.isArray(localVal)) {
      rows.push({ key: fullKey, oldVal: JSON.stringify(localVal), newVal: '(array — not comparable)', status: 'skipped' });
      continue;
    }
    const liveVal = live?.[key];
    if (liveVal === undefined) {
      rows.push({ key: fullKey, oldVal: JSON.stringify(localVal), newVal: '(absent)', status: 'missing' });
    } else if (String(liveVal) !== String(localVal)) {
      rows.push({ key: fullKey, oldVal: JSON.stringify(localVal), newVal: JSON.stringify(liveVal), status: 'drift' });
    } else {
      rows.push({ key: fullKey, oldVal: JSON.stringify(localVal), newVal: JSON.stringify(liveVal), status: 'match' });
    }
  }
  return rows;
}

async function diffSettings(serverId: string): Promise<boolean> {
  heading('SETTINGS  (golden-server-settings.json vs live cs2_settings)');
  const { status, json } = await api('GET', `/game-servers/${serverId}`);
  if (status !== 200) {
    console.error(c.red(`✖ could not read live server (${status})`));
    process.exit(2);
  }
  const live = json as Record<string, unknown>;
  const liveCs2 = (live.cs2_settings ?? {}) as Record<string, unknown>;
  const golden = loadGolden();

  const rows = [...compareFlat('server', golden.server, live), ...compareFlat('cs2_settings', golden.cs2_settings, liveCs2)];
  printTable(rows, 'golden', 'live');

  const drifted = rows.filter((r) => r.status === 'drift' || r.status === 'missing').length;
  const skipped = rows.filter((r) => r.status === 'skipped').length;
  const matched = rows.filter((r) => r.status === 'match').length;
  console.error('');
  console.error(`  ${matched} matched, ${drifted} drifted, ${skipped} skipped (arrays — check manually)`);
  return drifted === 0;
}

/** List everything DatHost reports under `cfg/` — used when a specific file 404s, so the user has
 *  something to point at instead of a bare 404. Paths come back relative to the `path=cfg` root
 *  (e.g. `MatchZy/config.cfg`), so `cfg/` is prepended to match the file-manager-rooted paths
 *  `CFG_FILES.remote` and the download endpoint both expect. */
async function listCfgDir(serverId: string): Promise<string[]> {
  const { status, json } = await api('GET', `/game-servers/${serverId}/files?path=cfg`);
  if (status !== 200 || !Array.isArray(json)) return [];
  return (json as Array<Record<string, unknown>>).map((f) => `cfg/${String(f.path ?? f.name ?? f)}`);
}

/**
 * Parse a MatchZy/CS2 cfg file into an ordered cvar -> value map. Skips blank lines and full-line
 * `//` comments; strips a trailing `;`. Cvar name = first whitespace-separated token, value = the
 * rest of the line. Duplicate keys (e.g. repeated `exec ...` lines) get a `[2]`, `[3]`… suffix so
 * they don't collide.
 */
function parseCfg(text: string): Map<string, string> {
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

function compareCfg(local: Map<string, string>, live: Map<string, string>): Row[] {
  const rows: Row[] = [];
  const keys = new Set([...local.keys(), ...live.keys()]);
  for (const key of keys) {
    const localVal = local.get(key);
    const liveVal = live.get(key);
    if (localVal === undefined) {
      rows.push({ key, oldVal: '(absent)', newVal: liveVal!, status: 'missing' });
    } else if (liveVal === undefined) {
      rows.push({ key, oldVal: localVal, newVal: '(absent)', status: 'missing' });
    } else if (localVal !== liveVal) {
      rows.push({ key, oldVal: localVal, newVal: liveVal, status: 'drift' });
    } else {
      rows.push({ key, oldVal: localVal, newVal: liveVal, status: 'match' });
    }
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  return rows;
}

async function diffCfgFiles(serverId: string): Promise<boolean> {
  heading('CFG FILES  (infra/matchzy/cfg/ vs live file manager, cvar-by-cvar)');
  let allMatch = true;
  let anyFetchFailed = false;

  for (const { local, remote } of CFG_FILES) {
    const localPath = join(REPO_ROOT, local);
    if (!existsSync(localPath)) {
      console.error(`  ${c.red('✖')} missing local file ${local}`);
      allMatch = false;
      continue;
    }

    const { status, text } = await api('GET', `/game-servers/${serverId}/files/${remote}`);
    if (status !== 200) {
      console.error(`  ${c.yellow('⚠')} ${remote} → ${status} (could not fetch)`);
      anyFetchFailed = true;
      allMatch = false;
      continue;
    }

    const localCfg = parseCfg(readFileSync(localPath, 'utf8'));
    const liveCfg = parseCfg(text);
    const rows = compareCfg(localCfg, liveCfg);
    const changed = rows.filter((r) => r.status !== 'match');

    console.error('');
    console.error(`  ${local}  ↔  live:${remote}`);
    if (changed.length === 0) {
      console.error(`  ${c.green('✓')} all ${rows.length} cvars match`);
      continue;
    }
    printTable(changed, 'local', 'live');
    console.error(`  ${rows.length - changed.length} matched, ${changed.length} differ`);
    allMatch = false;
  }

  if (anyFetchFailed) {
    console.error('');
    console.error(c.dim('  one or more files could not be fetched — listing what DatHost has under cfg/:'));
    const found = await listCfgDir(serverId);
    if (found.length === 0) {
      console.error(c.dim('    (listing also failed or returned nothing — check credentials/server id, or'));
      console.error(c.dim('     capture manually via DatHost File Manager/FTP and paste the content in.)'));
    } else {
      for (const f of found) console.error(`    - ${f}`);
      console.error(c.dim('  point CFG_FILES at the right remote path above, or paste content in manually.'));
    }
  }

  return allMatch;
}

async function main() {
  const serverId = process.argv[2] || process.env.DATHOST_SERVER_ID;
  if (!serverId) {
    console.error(c.red('✖ pass a server id or set DATHOST_SERVER_ID'));
    process.exit(2);
  }

  console.error(c.bold(`DGLS golden config diff — server ${serverId}`));

  const settingsOk = await diffSettings(serverId);
  const cfgOk = await diffCfgFiles(serverId);

  heading('RESULT');
  if (settingsOk && cfgOk) {
    console.error(c.green('✓ live server matches the versioned golden config.'));
    process.exit(0);
  }
  console.error(c.red('✗ drift found — see above. Nothing was changed.'));
  process.exit(1);
}

main().catch((e) => {
  console.error(c.red('✖'), e instanceof Error ? e.message : e);
  process.exit(2);
});
