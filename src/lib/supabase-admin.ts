import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type GlobalWithAdminClient = typeof globalThis & {
  __dgls_adminClient?: SupabaseClient;
};

export function getAdminClient(): SupabaseClient {
  const g = globalThis as GlobalWithAdminClient;
  if (g.__dgls_adminClient) return g.__dgls_adminClient;
  g.__dgls_adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  return g.__dgls_adminClient;
}
