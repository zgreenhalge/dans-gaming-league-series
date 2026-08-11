import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

type GlobalWithAdminClient = typeof globalThis & {
  __dgls_adminClient?: SupabaseClient<Database>;
};

export function getAdminClient(): SupabaseClient<Database> {
  const g = globalThis as GlobalWithAdminClient;
  if (g.__dgls_adminClient) return g.__dgls_adminClient;
  g.__dgls_adminClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  return g.__dgls_adminClient;
}

/**
 * Test-only: inject a fake client so `getAdminClient()` (and everything built on it, like the
 * route-handler access gates in `season-roster-access.ts`/`match-access.ts`/`admin-access.ts`) runs
 * against it instead of a real Supabase connection. Call with `undefined` to restore real-client
 * behavior. Not used by application code.
 */
export function __setTestAdminClient(client: SupabaseClient<Database> | undefined): void {
  const g = globalThis as GlobalWithAdminClient;
  g.__dgls_adminClient = client;
}
