'use client';

import { useEffect, useRef } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { getBrowserClient } from '@/lib/supabase-browser';

export type RealtimeChange = RealtimePostgresChangesPayload<Record<string, unknown>>;

interface ChangesFilter {
  event: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  /** PostgREST-style row filter, e.g. `match_id=eq.42`. */
  filter?: string;
}

/**
 * Subscribes to `postgres_changes` on one `public` table and calls `onChange` for each event, on a
 * channel named `channelName` that is removed on unmount. Does nothing while `enabled` is false or
 * when the browser Supabase env is unset (`getBrowserClient()` returns `null`). `onChange` is read
 * through a ref, so it can be an inline closure without resubscribing on every render; the channel
 * is rebuilt only when `channelName`, the filter or `enabled` changes.
 */
export function useRealtimeChanges(
  channelName: string,
  { event, table, filter }: ChangesFilter,
  onChange: (payload: RealtimeChange) => void,
  enabled = true,
): void {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!enabled) return;
    const client = getBrowserClient();
    if (!client) return;
    const channel = client
      .channel(channelName)
      .on(
        'postgres_changes',
        { event, schema: 'public', table, filter },
        (payload: RealtimeChange) => onChangeRef.current(payload),
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [channelName, event, table, filter, enabled]);
}
