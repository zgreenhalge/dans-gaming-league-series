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
// The comparison itself (settings field-by-field, cfg files cvar-by-cvar so comment/whitespace edits
// aren't noise) lives in `src/lib/dathost-config.ts` — the same code the admin console and provisioning
// use — so this script only renders the result. When a cfg file can't be fetched it also lists what
// DatHost *does* have under `cfg/`, so you can point at the right path instead of a bare error.

import { api } from './dathost-golden-shared';
import { diffGoldenConfig, type DiffRow } from '../src/lib/dathost-config';

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

function statusGlyph(status: DiffRow['status']): string {
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

/** Print a name / local / live table, right-padded to align columns. */
function printTable(rows: DiffRow[], localLabel: string, liveLabel: string) {
  if (rows.length === 0) return;
  const keyW = Math.max(...rows.map((r) => r.key.length), 3);
  const localW = Math.max(...rows.map((r) => r.local.length), localLabel.length);
  console.error(`    ${' '.padEnd(keyW)}  ${localLabel.padEnd(localW)}  ${liveLabel}`);
  for (const row of rows) {
    console.error(`  ${statusGlyph(row.status)} ${row.key.padEnd(keyW)}  ${row.local.padEnd(localW)}  ${row.live}`);
  }
}

/** List everything DatHost reports under `cfg/` — used when a specific file couldn't be fetched, so
 *  the user has something to point at instead of a bare error. */
async function listCfgDir(serverId: string): Promise<string[]> {
  const { status, json } = await api('GET', `/game-servers/${serverId}/files?path=cfg`);
  if (status !== 200 || !Array.isArray(json)) return [];
  return (json as Array<Record<string, unknown>>).map((f) => `cfg/${String(f.path ?? f.name ?? f)}`);
}

async function main() {
  const serverId = process.argv[2] || process.env.DATHOST_SERVER_ID;
  if (!serverId) {
    console.error(c.red('✖ pass a server id or set DATHOST_SERVER_ID'));
    process.exit(2);
  }

  console.error(c.bold(`DGLS golden config diff — server ${serverId}`));

  const diff = await diffGoldenConfig(serverId);

  heading('SETTINGS  (golden-server-settings.json vs live cs2_settings)');
  printTable(diff.settings, 'golden', 'live');
  const drifted = diff.settings.filter((r) => r.status === 'drift' || r.status === 'missing').length;
  const skipped = diff.settings.filter((r) => r.status === 'skipped').length;
  const matched = diff.settings.filter((r) => r.status === 'match').length;
  console.error('');
  console.error(`  ${matched} matched, ${drifted} drifted, ${skipped} skipped (arrays — check manually)`);

  heading('CFG FILES  (infra/matchzy/cfg/ vs live file manager, cvar-by-cvar)');
  let anyFetchFailed = false;
  for (const file of diff.cfgFiles) {
    console.error('');
    console.error(`  ${file.local}  ↔  live:${file.remote}`);
    if (file.error) {
      console.error(`  ${c.yellow('⚠')} ${file.error}`);
      anyFetchFailed = true;
      continue;
    }
    const changed = file.rows.filter((r) => r.status !== 'match');
    if (changed.length === 0) {
      console.error(`  ${c.green('✓')} all ${file.rows.length} cvars match`);
      continue;
    }
    printTable(changed, 'local', 'live');
    console.error(`  ${file.rows.length - changed.length} matched, ${changed.length} differ`);
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

  heading('RESULT');
  if (diff.clean) {
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
