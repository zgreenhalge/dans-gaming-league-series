// Shared plumbing for the DatHost-facing scripts (dathost-golden-diff.ts, dathost-golden-apply.ts,
// dathost-cleanup.ts, dathost-smoke.ts): the DatHost REST client basics, the tracked cfg-file list,
// and a tiny CLI flag reader. Keeps them from drifting out of sync with each other.

import { join } from 'node:path';

export const BASE = 'https://dathost.com/api/0.1';
export const REPO_ROOT = join(__dirname, '..');
export const GOLDEN_JSON_PATH = join(REPO_ROOT, 'infra/matchzy/golden-server-settings.json');

// The tracked cfg-file list lives in `src/lib/dathost-config.ts` (the same module the app uses to
// push/diff them), so the CLI and the app can never disagree on which files are golden. Re-exported
// here so the scripts keep a single import point.
export { CFG_FILES } from '../src/lib/dathost-config';

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

/** Reads the value following `flag` in `args` (e.g. `flagValue(argv, '--capture')`), or `undefined`
 *  if the flag is absent or has no value (the next token is itself a flag or missing). */
export function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}
