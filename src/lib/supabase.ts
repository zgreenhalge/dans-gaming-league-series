import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { createSingleton } from './supabase-singleton';

// Server-side Supabase client. Currently uses no-op cookie handlers because
// there's no auth yet — this keeps pages eligible for ISR (calling cookies()
// from next/headers would opt routes out of static generation).
//
// When auth lands (for match entry flows), this becomes two clients:
//   - server: createServerClient with real cookies() from next/headers
//             (those routes will no longer be ISR-cacheable, which is correct
//             — authenticated reads/writes must hit the database per-request).
//   - browser: createBrowserClient for client components that need auth state.
const serverClient = createSingleton<SupabaseClient<Database>>(() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (local) and Vercel project settings (deployed).',
    );
  }
  return createServerClient<Database>(url, anon, {
    cookies: {
      getAll() {
        return [];
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      setAll(_: { name: string; value: string; options: CookieOptions }[]) {
        // no-op until auth is wired up
      },
    },
  });
});

export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    return Reflect.get(serverClient.get(), prop, receiver);
  },
});

/**
 * Test-only: inject a fake client so `supabase` (and everything built on it, like
 * `src/lib/queries.ts`) runs against it instead of a real Supabase connection. Call with
 * `undefined` to restore real-client behavior. Not used by application code.
 */
export function __setTestClient(client: SupabaseClient<Database> | undefined): void {
  serverClient.set(client);
}
