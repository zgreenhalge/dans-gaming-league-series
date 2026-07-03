// Resolve drift between the versioned golden DatHost config (infra/matchzy/) and the live DGLS
// match server, in one of two directions. Always run scripts/dathost-golden-diff.ts first to see
// what's actually different — this script does not diff, it just applies.
//
//   set -a; . ./.env.local; set +a
//
//   --capture <serverId> --yes     live server → repo files (recapture: the panel was intentionally
//                                   retuned and should become the new golden baseline)
//   --reassert <serverId> --yes    repo files → live server (push golden config, overwriting
//                                   whatever recreational-mode drift happened in the panel)
//
// Both mutate real state (repo files on disk, or the live match server) and require --yes.
// --reassert only PUTs scalar cs2_settings/server fields (mirrors buildGoldenCs2Fields() in
// src/lib/dathost.ts) — array fields like metamod_plugins are skipped, matching that file's
// documented reasoning: DatHost preserves them across changes, so guessing form-encoding for an
// array isn't worth the risk. --reassert also does not touch per_match_overrides (those are
// per-match, not part of the static baseline) or cfg file uploads if the files endpoint 404s.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, REPO_ROOT, GOLDEN_JSON_PATH, CFG_FILES, authHeader, api } from './dathost-golden-shared';

function loadGoldenRaw(): Record<string, unknown> {
  return JSON.parse(readFileSync(GOLDEN_JSON_PATH, 'utf8'));
}

async function capture(serverId: string) {
  console.error(`— GET /game-servers/${serverId} (live cs2_settings) —`);
  const { status, json } = await api('GET', `/game-servers/${serverId}`);
  if (status !== 200) {
    console.error(`✖ could not read live server (${status})`);
    process.exit(2);
  }
  const live = json as Record<string, unknown>;
  const liveCs2 = (live.cs2_settings ?? {}) as Record<string, unknown>;
  const golden = loadGoldenRaw();
  const localServer = (golden.server ?? {}) as Record<string, unknown>;
  const localCs2 = (golden.cs2_settings ?? {}) as Record<string, unknown>;

  const newServer: Record<string, unknown> = { ...localServer };
  for (const key of Object.keys(localServer)) {
    if (live[key] !== undefined) newServer[key] = live[key];
  }
  const newCs2: Record<string, unknown> = { ...localCs2 };
  for (const key of Object.keys(localCs2)) {
    if (liveCs2[key] !== undefined) newCs2[key] = liveCs2[key];
  }

  const updated = {
    ...golden,
    note: `${(golden.note as string).replace(/Captured live [\d-]+\.?/, '').trim()} Captured live ${new Date().toISOString().slice(0, 10)}.`,
    server: newServer,
    cs2_settings: newCs2,
  };
  writeFileSync(GOLDEN_JSON_PATH, JSON.stringify(updated, null, 2) + '\n');
  console.error(`✓ wrote ${GOLDEN_JSON_PATH} from live settings`);

  for (const { local, remote } of CFG_FILES) {
    console.error(`— GET /game-servers/${serverId}/files/${remote} —`);
    const { status: fstatus, text } = await api('GET', `/game-servers/${serverId}/files/${remote}`);
    if (fstatus !== 200) {
      console.error(`  ⚠ could not fetch ${remote} (${fstatus}) — left ${local} untouched.`);
      console.error(`    Capture it manually via DatHost File Manager/FTP.`);
      continue;
    }
    const localPath = join(REPO_ROOT, local);
    writeFileSync(localPath, text);
    console.error(`  ✓ wrote ${local} from live ${remote}`);
  }

  console.error('\nReview the diff (`git diff infra/matchzy/`) before committing.');
}

async function reassert(serverId: string) {
  const golden = loadGoldenRaw();
  const localServer = (golden.server ?? {}) as Record<string, unknown>;
  const localCs2 = (golden.cs2_settings ?? {}) as Record<string, unknown>;

  const fields: Record<string, string> = {};
  for (const [key, val] of Object.entries(localServer)) {
    if (Array.isArray(val)) {
      console.error(`  ~ skipping server.${key} (array — not re-asserted, see script header)`);
      continue;
    }
    fields[key] = String(val);
  }
  for (const [key, val] of Object.entries(localCs2)) {
    if (Array.isArray(val)) {
      console.error(`  ~ skipping cs2_settings.${key} (array — not re-asserted, see script header)`);
      continue;
    }
    fields[`cs2_settings.${key}`] = String(val);
  }

  console.error(`— PUT /game-servers/${serverId} (golden settings) —`);
  const put = await api('PUT', `/game-servers/${serverId}`, new URLSearchParams(fields));
  if (put.status >= 400) {
    console.error(`✖ PUT failed (${put.status}): ${put.text.slice(0, 300)}`);
    process.exit(2);
  }
  console.error(`✓ settings pushed (${put.status})`);

  for (const { local, remote } of CFG_FILES) {
    const localPath = join(REPO_ROOT, local);
    if (!existsSync(localPath)) {
      console.error(`  ⚠ missing local ${local} — skipped`);
      continue;
    }
    console.error(`— POST /game-servers/${serverId}/files/${remote} —`);
    const content = readFileSync(localPath, 'utf8');
    const res = await fetch(`${BASE}/game-servers/${serverId}/files/${remote}`, {
      method: 'POST',
      headers: { Authorization: authHeader() },
      body: (() => {
        const form = new FormData();
        form.append('file', new Blob([content]), remote.split('/').pop());
        return form;
      })(),
    });
    if (!res.ok) {
      console.error(`  ✗ upload failed (${res.status}) for ${remote}`);
    } else {
      console.error(`  ✓ pushed ${local} → ${remote}`);
    }
  }

  console.error('\nSettings apply on next provision (or next PUT). cfg files apply on next server boot.');
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');

  const captureId = flagValue(args, '--capture');
  const reassertId = flagValue(args, '--reassert');

  if (!captureId && !reassertId) {
    console.error('Usage: tsx scripts/dathost-golden-apply.ts --capture <serverId> --yes');
    console.error('   or: tsx scripts/dathost-golden-apply.ts --reassert <serverId> --yes');
    process.exit(2);
  }
  if (!yes) {
    console.error('⚠ this mutates real state (repo files or the live match server). Re-run with --yes.');
    process.exit(1);
  }

  if (captureId) await capture(captureId);
  else if (reassertId) await reassert(reassertId);
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(2);
});
