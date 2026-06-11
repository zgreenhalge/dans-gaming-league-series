import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type GlobalWithClients = typeof globalThis & {
  __dgls_browserClient?: SupabaseClient;
  __dgls_serverClient?: SupabaseClient;
};

export function getBrowserClient(): SupabaseClient {
  const g = globalThis as GlobalWithClients;
  if (g.__dgls_browserClient) return g.__dgls_browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  g.__dgls_browserClient = createClient(url, anon);
  return g.__dgls_browserClient;
}

// Server-side Supabase client. Currently uses no-op cookie handlers because
// there's no auth yet — this keeps pages eligible for ISR (calling cookies()
// from next/headers would opt routes out of static generation).
//
// When auth lands (for match entry flows), this becomes two clients:
//   - server: createServerClient with real cookies() from next/headers
//             (those routes will no longer be ISR-cacheable, which is correct
//             — authenticated reads/writes must hit the database per-request).
//   - browser: createBrowserClient for client components that need auth state.
function getClient(): SupabaseClient {
  const g = globalThis as GlobalWithClients;
  if (g.__dgls_serverClient) return g.__dgls_serverClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (local) and Vercel project settings (deployed).',
    );
  }
  g.__dgls_serverClient = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return [];
      },
      setAll(_cookies: { name: string; value: string; options: CookieOptions }[]) {
        // no-op until auth is wired up
      },
    },
  });
  return g.__dgls_serverClient;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});
