import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { getOrCreateSingleton, setSingleton } from './supabase-singleton';
import { hasNoSupabaseConfig, getDevFallbackSupabaseClient } from './dev-fallback-supabase';

// The one server-side Supabase client: service-role key, so it bypasses RLS. Every table has RLS on
// with no policies for `anon`/`authenticated` outside the few the browser's Realtime subscriptions
// read (see `supabase-browser.ts`), so all server reads and writes go through this client. The key is
// not a `NEXT_PUBLIC_*` var, so it is never inlined into a client bundle; a client component that
// reaches this module fails at call time with the missing-env error below rather than leaking it.
function createAdminSupabaseClient(): SupabaseClient<Database> {
  if (hasNoSupabaseConfig()) return getDevFallbackSupabaseClient();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (local) and Vercel project settings (deployed).',
    );
  }
  return createClient<Database>(url, serviceRoleKey);
}

export function getAdminClient(): SupabaseClient<Database> {
  return getOrCreateSingleton('admin', createAdminSupabaseClient);
}

/**
 * Test-only: inject a fake client so `getAdminClient()` (and everything built on it, like the
 * route-handler access gates in `season-roster-access.ts`/`match-access.ts`/`admin-access.ts`) runs
 * against it instead of a real Supabase connection. Call with `undefined` to restore real-client
 * behavior. Not used by application code.
 */
export function __setTestAdminClient(client: SupabaseClient<Database> | undefined): void {
  setSingleton('admin', client);
}
