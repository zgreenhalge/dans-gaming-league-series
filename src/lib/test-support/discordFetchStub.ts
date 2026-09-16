/**
 * Shared `fetch` stubbing for tests exercising Discord REST calls (`discord-roles.ts` directly, or
 * indirectly via `season-lifecycle.ts`'s best-effort role sync) — env var setup plus a couple of
 * `global.fetch` stand-ins, factored out so both test files don't each carry their own copy.
 */

export const DISCORD_ENV_KEYS = ['DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID', 'DISCORD_PARTICIPANTS_ROLE_ID'] as const;

export function setDiscordEnv() {
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  process.env.DISCORD_GUILD_ID = 'test-guild-id';
  process.env.DISCORD_PARTICIPANTS_ROLE_ID = 'test-role-id';
}

export function clearDiscordEnv() {
  for (const key of DISCORD_ENV_KEYS) delete process.env[key];
}

export interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
}

/** Stubs `global.fetch` to return the same status for every call. */
export function stubFetch(status = 204): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null } } as unknown as Response;
  }) as typeof fetch;
  return { calls };
}

/** Like `stubFetch()`, but returns a different response for each successive call (holding the last
 *  one for any call beyond the list) — for exercising multi-request sequences (create → resolve the
 *  bot's top role position → reposition → assign) and 429-retry sequences. `headers` lets a 429
 *  response carry a `Retry-After` value. */
export function stubFetchSequence(responses: { status: number; json?: unknown; headers?: Record<string, string> }[]): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let i = 0;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json ?? {},
      headers: { get: (name: string) => r.headers?.[name.toLowerCase()] ?? null },
    } as unknown as Response;
  }) as typeof fetch;
  return { calls };
}
