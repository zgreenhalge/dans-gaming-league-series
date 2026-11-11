'use client';

import { startTransition, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useRealtimeChanges, type RealtimeChange } from './useRealtimeChanges';
import { isPlayedScore } from '@/lib/util';

/** How often a visible page re-renders when no Realtime event has arrived, with `fallback`. */
const FALLBACK_REFRESH_MS = 30_000;

/** How long after the last event the page waits before it refreshes. A result is several writes in a
 *  row (the match's score, then its players' stats), so the refresh lands once they have, and a burst
 *  of events costs one refresh. */
const SETTLE_MS = 3_000;

/** Re-renders the server page whenever a row it depends on changes, so the change shows up for every
 *  viewer without a reload. Realtime delivers the change on `table`, narrowed by `filter` (a
 *  PostgREST-style row filter, e.g. `match_id=eq.42` or `week_id=in.(3,4)`) and `event`; the table
 *  needs to be in the Realtime publication with `anon` able to select its primary key and filter
 *  column (`docs/recipes.md`, "Add a new table"). Postgres can't filter a delete, so a `DELETE`
 *  subscription takes no `filter` and hears every delete on the table. With `onlyPlayed`, only a row
 *  whose `final_score` is a played score triggers the refresh. With `fallback`, a missed event is
 *  also caught when the tab becomes visible again and by a slow refresh while it stays open — only
 *  for a light page, since each refresh re-runs the whole server page. Renders nothing. */
export function RefreshOnServerState({
  table,
  filter,
  event = '*',
  onlyPlayed = false,
  fallback = false,
}: {
  table: string;
  filter?: string;
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  onlyPlayed?: boolean;
  fallback?: boolean;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useRealtimeChanges(
    `refresh:${table}:${event}:${filter ?? 'all'}`,
    { event, table, filter },
    (payload: RealtimeChange) => {
      if (onlyPlayed && !isPlayedScore((payload.new as { final_score?: string | null }).final_score)) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => startTransition(() => router.refresh()), SETTLE_MS);
    },
  );

  useEffect(() => {
    if (!fallback) return;
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') startTransition(() => router.refresh());
    };
    document.addEventListener('visibilitychange', refreshIfVisible);
    const id = setInterval(refreshIfVisible, FALLBACK_REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', refreshIfVisible);
      clearInterval(id);
    };
  }, [router, fallback]);

  return null;
}
