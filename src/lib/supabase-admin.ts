import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { getOrCreateSingleton, setSingleton } from './supabase-singleton';
import { hasNoSupabaseConfig, getDevFallbackSupabaseClient } from './dev-fallback-supabase';

function createAdminSupabaseClient(): SupabaseClient<Database> {
  if (hasNoSupabaseConfig()) return getDevFallbackSupabaseClient();

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
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
