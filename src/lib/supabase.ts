import { type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { getAdminClient, __setTestAdminClient } from './supabase-admin';

// Server-side client for reads (`src/lib/queries/`, pages, `generateMetadata()`): the same
// service-role client `getAdminClient()` returns, lazily resolved so importing this module never
// constructs anything. Kept as a named export so query helpers read as `supabase.from(...)` and
// route handlers that write read as `getAdminClient()` — one client, two spellings.
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    return Reflect.get(getAdminClient(), prop, receiver);
  },
});

/**
 * Test-only: inject a fake client so `supabase` (and everything built on it, like
 * `src/lib/queries.ts`) runs against it instead of a real Supabase connection. Call with
 * `undefined` to restore real-client behavior. Not used by application code. Shares the singleton
 * `__setTestAdminClient()` sets, since `supabase` and `getAdminClient()` are one client.
 */
export function __setTestClient(client: SupabaseClient<Database> | undefined): void {
  __setTestAdminClient(client);
}
