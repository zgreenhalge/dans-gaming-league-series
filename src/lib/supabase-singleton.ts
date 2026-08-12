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

/** Returns the cached value for `key`, creating it via `create()` on first call. */
export function getOrCreateSingleton<T>(key: SingletonKey, create: () => T): T {
  const s = store();
  if (s.has(key)) return s.get(key) as T;
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
