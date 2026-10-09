import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBrowserClient } from './supabase-browser';
import { setSingleton } from './supabase-singleton';

// `getBrowserClient()` returns null on missing public env so Realtime components skip subscribing
// instead of throwing `supabaseUrl is required` during render.

const ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const;

describe('getBrowserClient()', () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) vi.stubEnv(k, '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    setSingleton('browser', undefined);
  });

  it('returns null with neither public var set', () => {
    expect(getBrowserClient()).toBeNull();
  });

  it('returns null with only the URL set', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    expect(getBrowserClient()).toBeNull();
  });

  it('returns null with only the anon key set', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    expect(getBrowserClient()).toBeNull();
  });

  it('returns the shared client with both set', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    const fake = {} as SupabaseClient;
    setSingleton('browser', fake);
    expect(getBrowserClient()).toBe(fake);
  });
});
