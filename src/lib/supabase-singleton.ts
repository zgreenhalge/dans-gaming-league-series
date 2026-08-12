// Shared globalThis-caching mechanics for the three Supabase client singletons (`supabase.ts`,
// `supabase-admin.ts`, `supabase-browser.ts`). Caching on `globalThis` (rather than a module-level
// variable) survives Next.js dev-server hot reloads, which re-evaluate modules but not globalThis.

type GlobalWithSingletons = typeof globalThis & {
  __dgls_singletons?: Map<symbol, unknown>;
};

function store(): Map<symbol, unknown> {
  const g = globalThis as GlobalWithSingletons;
  g.__dgls_singletons ??= new Map();
  return g.__dgls_singletons;
}

/**
 * Creates a typed globalThis-backed singleton slot: `get()` returns the cached value, calling
 * `create()` on first access; `set()` is a test-only override (pass `undefined` to clear it back
 * to real-client behavior). Keyed by a private `Symbol` per call site so slots can never collide,
 * unlike a shared string-keyed cache.
 */
export function createSingleton<T>(create: () => T): { get: () => T; set: (value: T | undefined) => void } {
  const key = Symbol();
  return {
    get(): T {
      const s = store();
      if (s.has(key)) return s.get(key) as T;
      const created = create();
      s.set(key, created);
      return created;
    },
    set(value: T | undefined): void {
      store().set(key, value);
    },
  };
}
