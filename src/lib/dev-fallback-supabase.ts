import type { SupabaseClient } from '@supabase/supabase-js';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import type { Database } from './database.types';

/**
 * True only when none of the three Supabase env vars are set — a fully unconfigured environment
 * (a fresh sandbox with no `.env.local` and no reachable local/remote Supabase), never a partially
 * misconfigured one. A real deployment (Vercel) always sets all three, so this never triggers there;
 * a broken deployment missing just one still hits `supabase.ts`/`supabase-admin.ts`'s existing
 * "Missing Supabase env vars" throw.
 */
export function hasNoSupabaseConfig(): boolean {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Cached on `globalThis` (not a module-level variable) for the same reason
// `supabase-singleton.ts` does it: this survives Next.js dev-server hot reloads, which re-evaluate
// modules but not globalThis. Deliberately its own cache rather than a `getOrCreateSingleton()` key
// — that function's Vitest guard exists to stop a *real* Supabase client from being built
// unexpectedly under test, which doesn't apply here since this factory only ever builds the
// harmless in-memory fixture client.
type GlobalWithFakeClient = typeof globalThis & {
  __dgls_dev_fallback_client?: SupabaseClient<Database>;
};

/**
 * The same in-memory fixture league the `queries.ts` regression harness runs against
 * (`test-support/fixtures.ts`), reused here so `npm run build`/`npm run dev` produce a real,
 * internally-consistent site with no live Supabase connection. Shared — not rebuilt — across
 * `supabase.ts` and `supabase-admin.ts` so a write made through one is visible through the other,
 * same as both pointing at one real database.
 */
export function getDevFallbackSupabaseClient(): SupabaseClient<Database> {
  const g = globalThis as GlobalWithFakeClient;
  if (!g.__dgls_dev_fallback_client) {
    console.warn(
      '[dgls] No NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY set — ' +
        'serving in-memory fixture data (src/lib/test-support/fixtures.ts) instead of a real database. ' +
        'Set those in .env.local for a real Supabase connection.',
    );
    g.__dgls_dev_fallback_client = createFakeSupabaseClient(buildFakeDb()) as unknown as SupabaseClient<Database>;
  }
  return g.__dgls_dev_fallback_client;
}
