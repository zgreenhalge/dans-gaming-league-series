// Shared plumbing for scripts/dathost-golden-diff.ts and scripts/dathost-golden-apply.ts: the
// DatHost REST client basics and the tracked cfg-file list. Both scripts operate on the same golden
// config, so this keeps them from drifting out of sync with each other.

import { join } from 'node:path';

export const BASE = 'https://dathost.com/api/0.1';
export const REPO_ROOT = join(__dirname, '..');
export const GOLDEN_JSON_PATH = join(REPO_ROOT, 'infra/matchzy/golden-server-settings.json');

// Local cfg path -> remote path, rooted at the DatHost file-manager root (i.e. includes `cfg/`) —
// confirmed against the live API + https://dathost.readme.io/reference/get_game_server_files_item.
export const CFG_FILES: Array<{ local: string; remote: string }> = [
  { local: 'infra/matchzy/cfg/MatchZy/config.cfg', remote: 'cfg/MatchZy/config.cfg' },
  { local: 'infra/matchzy/cfg/server.cfg', remote: 'cfg/server.cfg' },
  { local: 'infra/matchzy/cfg/gamemode_competitive2v2_server.cfg', remote: 'cfg/gamemode_competitive2v2_server.cfg' },
  { local: 'infra/matchzy/cfg/MatchZy/live_override.cfg', remote: 'cfg/MatchZy/live_override.cfg' },
];

export function authHeader(): string {
  const email = process.env.DATHOST_EMAIL;
  const password = process.env.DATHOST_PASSWORD;
  if (!email || !password) {
    console.error('✖ set DATHOST_EMAIL and DATHOST_PASSWORD (set -a; . ./.env.local; set +a)');
    process.exit(2);
  }
  return 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64');
}

export async function api(
  method: string,
  path: string,
  body?: URLSearchParams,
): Promise<{ status: number; text: string; json: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON — file downloads are raw text/bytes */
  }
  return { status: res.status, text, json };
}
