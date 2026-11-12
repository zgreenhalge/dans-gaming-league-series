'use client';

import { startTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useRealtimeChanges } from './useRealtimeChanges';

/** How often a visible page re-renders when no Realtime event has arrived. */
const FALLBACK_REFRESH_MS = 30_000;

/** Re-renders the server page whenever the match's server state changes (it starts, its game ends, it
 *  stops), so what depends on it shows up for every viewer without a reload. Realtime delivers the
 *  change; a missed event is caught when the tab becomes visible again and by a slow refresh while it
 *  stays open. With `followMatchRow`, it also re-renders whenever the match's own `matches` row changes
 *  — a scrim match's lobby edits all bump its `scrim_revision` — so every viewer sees an edit at once.
 *  Renders nothing. */
export function RefreshOnServerState({ matchId, followMatchRow = false }: { matchId: number; followMatchRow?: boolean }) {
  const router = useRouter();
  useRealtimeChanges(
    `match-server-refresh-${matchId}`,
    { event: '*', table: 'match_server_state', filter: `match_id=eq.${matchId}` },
    () => startTransition(() => router.refresh()),
  );
  useRealtimeChanges(
    `match-row-refresh-${matchId}`,
    { event: '*', table: 'matches', filter: `id=eq.${matchId}` },
    () => startTransition(() => router.refresh()),
    followMatchRow,
  );

  useEffect(() => {
    const refresh = () => startTransition(() => router.refresh());
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', refreshIfVisible);
    const id = setInterval(refreshIfVisible, FALLBACK_REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', refreshIfVisible);
      clearInterval(id);
    };
  }, [router]);

  return null;
}
