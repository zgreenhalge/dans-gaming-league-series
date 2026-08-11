// Shared plumbing for the DatHost-facing CLI scripts (dathost-golden-diff.ts, dathost-golden-apply.ts,
// dathost-cleanup.ts, seed-config-set.ts): a `{status, text, json}` wrapper over `src/lib/dathost.ts`'s
// `request()` — the same URL/auth/body-encoding construction the app itself uses — plus a tiny CLI
// flag reader. Kept separate from `call()` (`src/lib/dathost.ts`) because a CLI script wants a status
// code back to report/log against, not a thrown `DathostError`.

import { request } from '../src/lib/dathost';

export async function api(
  method: string,
  path: string,
  body?: Record<string, string> | FormData,
): Promise<{ status: number; text: string; json: unknown }> {
  const res = await request(method, path, body);
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
