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
