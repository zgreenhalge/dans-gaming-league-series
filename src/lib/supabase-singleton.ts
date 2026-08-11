// Shared globalThis-caching mechanics for the three Supabase client singletons (`supabase.ts`,
// `supabase-admin.ts`, `supabase-browser.ts`). Caching on `globalThis` (rather than a module-level
// variable) survives Next.js dev-server hot reloads, which re-evaluate modules but not globalThis.

type GlobalWithSingletons = typeof globalThis & {
  __dgls_singletons?: Record<string, unknown>;
};

/** Returns the cached value for `key`, creating it via `create()` on first call. */
export function getOrCreateSingleton<T>(key: string, create: () => T): T {
  const g = globalThis as GlobalWithSingletons;
  g.__dgls_singletons ??= {};
  const cached = g.__dgls_singletons[key];
  if (cached) return cached as T;
  const created = create();
  g.__dgls_singletons[key] = created;
  return created;
}

/** Test-only: inject or clear (`undefined`) the cached value for `key`. */
export function setSingleton<T>(key: string, value: T | undefined): void {
  const g = globalThis as GlobalWithSingletons;
  g.__dgls_singletons ??= {};
  g.__dgls_singletons[key] = value;
}
