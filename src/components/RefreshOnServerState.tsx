'use client';

import { startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useRealtimeChanges } from './useRealtimeChanges';

/** Re-renders the server page whenever the match's server state changes (it starts, its game ends, it
 *  stops), so what depends on it shows up for every viewer without a reload. Renders nothing. */
export function RefreshOnServerState({ matchId }: { matchId: number }) {
  const router = useRouter();
  useRealtimeChanges(
    `match-server-refresh-${matchId}`,
    { event: '*', table: 'match_server_state', filter: `match_id=eq.${matchId}` },
    () => startTransition(() => router.refresh()),
  );
  return null;
}
