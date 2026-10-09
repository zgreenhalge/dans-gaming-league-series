import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getOrCreateSingleton } from './supabase-singleton';

let warnedMissingEnv = false;

/**
 * The browser's anon-key client, used only for Realtime subscriptions. Returns `null` when
 * `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is unset, so a Realtime component
 * skips subscribing and renders its server-fetched data without live updates rather than throwing
 * `supabaseUrl is required` during render. Unlike `getAdminClient()` there is no in-memory fallback:
 * the fixture client (`dev-fallback-supabase.ts`) has no Realtime channels to subscribe to.
 */
export function getBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    if (!warnedMissingEnv) {
      warnedMissingEnv = true;
      console.warn(
        '[dgls] NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY not set — live (Realtime) updates are off.',
      );
    }
    return null;
  }
  return getOrCreateSingleton('browser', () => createClient(url, anon));
}
