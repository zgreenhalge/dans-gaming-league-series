import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type GlobalWithBrowserClient = typeof globalThis & {
  __dgls_browserClient?: SupabaseClient;
};

export function getBrowserClient(): SupabaseClient {
  const g = globalThis as GlobalWithBrowserClient;
  if (g.__dgls_browserClient) return g.__dgls_browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  g.__dgls_browserClient = createClient(url, anon);
  return g.__dgls_browserClient;
}
