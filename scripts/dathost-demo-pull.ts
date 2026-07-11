// Pull a match's recorded demo directly off the DatHost server's local disk into R2, for a match
// whose demo never reached R2 through the normal Worker-upload path (e.g. the server was started
// and stopped manually instead of through the usual provision/loadmatch flow, so
// `matchzy_demo_upload_url` was never set). Mirrors the file-listing read path
// `dathost-cleanup.ts` uses, but downloads instead of deleting.
//
// Usage (env-driven, so the same script runs locally or in a GitHub Action):
//   MATCH_ID=<id> [MAP_FILTER=<substring>] [DATE_FILTER=YYYY-MM-DD] [DEMO_PATH=<exact remote path>] \
//     npx tsx scripts/dathost-demo-pull.ts [serverId]
//
// DEMO_PATH, if set, is used verbatim (still checked against the server's file listing) and skips
// MAP_FILTER/DATE_FILTER matching entirely. Otherwise the script lists every `.dem` under
// `MatchZy/` and narrows by whichever filters are set — MatchZy's own `{TIME}_{MATCH_ID}_{MAP}`
// filename format embeds a match id that isn't trustworthy when the server ran with a stale or
// broken match config, so MAP_FILTER/DATE_FILTER exist to identify the right file by map name or
// date instead. Refuses to guess: exits with every candidate listed unless exactly one file matches.
//
// Env: DATHOST_EMAIL, DATHOST_PASSWORD, DATHOST_SERVER_ID (or pass a server id as an argument),
// CLOUDFLARE_R2_*.

import { authHeader, BASE } from './dathost-golden-shared';
import { putR2Object, demoKey } from '../src/lib/r2';

interface RemoteFile {
  path: string;
  size: number;
}

function notice(msg: string) {
  console.log(`::notice::${msg}`);
}

/** Every `.dem` under `MatchZy/` on the server, full relative path + size. */
async function listDemoFiles(serverId: string): Promise<RemoteFile[]> {
  const res = await fetch(`${BASE}/game-servers/${serverId}/files?path=`, {
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) {
    throw new Error(`Could not list server files (status ${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as Array<{ path: string; size?: number }>;
  return json
    .map((f) => ({ path: f.path, size: f.size ?? 0 }))
    .filter((f) => f.path.startsWith('MatchZy/') && f.path.toLowerCase().endsWith('.dem'));
}

async function downloadFile(serverId: string, path: string): Promise<Buffer> {
  const res = await fetch(`${BASE}/game-servers/${serverId}/files/${path}`, {
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) throw new Error(`Could not download ${path} (status ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const matchId = Number(process.env.MATCH_ID);
  if (!Number.isInteger(matchId) || matchId <= 0) throw new Error(`Bad MATCH_ID: ${process.env.MATCH_ID}`);

  const serverId = process.argv[2] || process.env.DATHOST_SERVER_ID;
  if (!serverId) throw new Error('Set DATHOST_SERVER_ID or pass a server id as an argument.');

  const explicitPath = process.env.DEMO_PATH;
  const mapFilter = process.env.MAP_FILTER?.toLowerCase();
  const dateFilter = process.env.DATE_FILTER;

  const files = await listDemoFiles(serverId);
  notice(`found ${files.length} .dem file(s) under MatchZy/`);
  for (const f of files) console.log(`  ${f.path} (${(f.size / 1024 / 1024).toFixed(1)} MB)`);

  let candidates: RemoteFile[];
  if (explicitPath) {
    candidates = files.filter((f) => f.path === explicitPath);
    if (candidates.length === 0) {
      throw new Error(`DEMO_PATH "${explicitPath}" not found among the listed files above.`);
    }
  } else {
    candidates = files.filter((f) => {
      if (mapFilter && !f.path.toLowerCase().includes(mapFilter)) return false;
      if (dateFilter && !f.path.includes(dateFilter)) return false;
      return true;
    });
  }

  if (candidates.length !== 1) {
    throw new Error(
      `${candidates.length} candidate demo(s) matched (need exactly 1) — narrow with MAP_FILTER/` +
        `DATE_FILTER/DEMO_PATH. Candidates:\n${candidates.map((f) => `  ${f.path}`).join('\n') || '  (none)'}`,
    );
  }

  const [file] = candidates;
  notice(`downloading ${file.path} (${(file.size / 1024 / 1024).toFixed(1)} MB) for match ${matchId}`);
  const demo = await downloadFile(serverId, file.path);
  if (demo.length === 0) throw new Error(`Downloaded ${file.path} but got 0 bytes.`);

  await putR2Object(demoKey(matchId), demo, { contentType: 'application/octet-stream' });
  notice(`uploaded ${demo.length} bytes to R2 at ${demoKey(matchId)} (source: ${file.path})`);
}

main().catch((err) => {
  console.log(`::error::dathost-demo-pull failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
