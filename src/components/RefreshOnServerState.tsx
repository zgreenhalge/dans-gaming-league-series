'use client';

import { startTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useRealtimeChanges } from './useRealtimeChanges';

/** How often a visible page re-renders when no Realtime event has arrived. */
const FALLBACK_REFRESH_MS = 30_000;

/** Re-renders the server page whenever the match's server state changes (it starts, its game ends, it
 *  stops), so what depends on it shows up for every viewer without a reload. Realtime delivers the
 *  change; a missed event is caught when the tab becomes visible again and by a slow refresh while it
 *  stays open. Renders nothing. */
export function RefreshOnServerState({ matchId }: { matchId: number }) {
  const router = useRouter();
  useRealtimeChanges(
    `match-server-refresh-${matchId}`,
    { event: '*', table: 'match_server_state', filter: `match_id=eq.${matchId}` },
    () => startTransition(() => router.refresh()),
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
