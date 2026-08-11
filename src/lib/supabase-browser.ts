import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getOrCreateSingleton } from './supabase-singleton';

export function getBrowserClient(): SupabaseClient {
  return getOrCreateSingleton('browser', () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    return createClient(url, anon);
  });
}
