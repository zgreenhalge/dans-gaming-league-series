// Shared globalThis-caching mechanics for the three Supabase client singletons (`supabase.ts`,
// `supabase-admin.ts`, `supabase-browser.ts`). Caching on `globalThis` (rather than a module-level
// variable) survives Next.js dev-server hot reloads, which re-evaluate modules but not globalThis
// — a fixed string key (not a `Symbol`, which would be re-minted, and unmatchable, on every reload)
// is what lets the cache be found again after a reload re-runs the module that first created it.

type SingletonKey = 'server' | 'admin' | 'browser';

type GlobalWithSingletons = typeof globalThis & {
  __dgls_singletons?: Map<SingletonKey, unknown>;
};

function store(): Map<SingletonKey, unknown> {
  const g = globalThis as GlobalWithSingletons;
  g.__dgls_singletons ??= new Map();
  return g.__dgls_singletons;
}

/** Returns the cached value for `key`, creating it via `create()` on first call.
 *
 * Refuses to run `create()` under Vitest (`process.env.VITEST`, set automatically by the test
 * runner) — reaching here under test means the test forgot to call this singleton's
 * `__setTestClient()`/`__setTestAdminClient()` override before exercising a code path that needs
 * it, and `create()` would otherwise silently build a real Supabase client against the real
 * database. Real credentials are wired into CI (`.github/workflows/ci.yml`, needed for `next
 * build`'s prerendering) and RLS is off on every table in this project, so an unmocked test isn't
 * just flaky — it can read or write production data over the network. Throwing here turns that into
 * an immediate, unmissable test failure instead of a slow network call that only shows up as a
 * mystery timeout (or, locally with no `.env.local`, a same-shaped error that a best-effort wrapper
 * silently swallows). */
export function getOrCreateSingleton<T>(key: SingletonKey, create: () => T): T {
  const s = store();
  if (s.has(key)) return s.get(key) as T;
  if (process.env.VITEST) {
    throw new Error(
      `getOrCreateSingleton('${key}'): a test exercised this without overriding it via __setTestClient()/__setTestAdminClient() first -- refusing to construct a real Supabase client under Vitest.`,
    );
  }
  const created = create();
  s.set(key, created);
  return created;
}

/** Test-only: inject the cached value for `key`, or clear it (`undefined`) back to real-client behavior. */
export function setSingleton<T>(key: SingletonKey, value: T | undefined): void {
  const s = store();
  if (value === undefined) {
    s.delete(key);
  } else {
    s.set(key, value);
  }
}
