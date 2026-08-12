import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSingleton } from './supabase-singleton';

const browserClient = createSingleton<SupabaseClient>(() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon);
});

export function getBrowserClient(): SupabaseClient {
  return browserClient.get();
}
