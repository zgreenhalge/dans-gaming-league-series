'use client';

// A scrim night's Stats and Advanced Stats tabs: the same views a season shows (`BasicStatsView`,
// `SabremetricsLeaderboardView`), over the night's scored matches. The stats data is heavy, so it is
// fetched (`GET /api/scrims/[id]/stats`) when one of the tabs first opens rather than with the page.

import { useEffect, useState } from 'react';
import { BasicStatsView } from './BasicStatsView';
import SabremetricsLeaderboardView from './SabremetricsLeaderboardView';
import { TabLoadingSkeleton, TabLoadError } from './Skeleton';
import type { ScrimNightStatsView } from '@/lib/queries';
import type { LeaderboardStatLine } from '@/lib/types';

/** One fetch per night and set of scored matches, shared by both tabs and kept across tab switches
 *  (the tab bar unmounts the tab that isn't showing). A newly scored match changes the key, so the
 *  next open fetches again; a failed fetch is dropped so Retry fetches again. */
const statsRequests = new Map<string, Promise<ScrimNightStatsView>>();

function loadStats(nightId: number, scoredMatchIds: number[]): Promise<ScrimNightStatsView> {
  const key = `${nightId}:${scoredMatchIds.join(',')}`;
  let request = statsRequests.get(key);
  if (!request) {
    request = fetch(`/api/scrims/${nightId}/stats`).then((res) => {
      if (!res.ok) throw new Error('Failed to load');
      return res.json() as Promise<ScrimNightStatsView>;
    });
    request.catch(() => statsRequests.delete(key));
    statsRequests.set(key, request);
  }
  return request;
}

/** `rows` are the night's totals the Stats view shows; the Advanced view reads its own data.
 *  `scoredMatchIds` are the night's scored matches, which the fetched data covers. */
export function ScrimNightStats({
  nightId,
  scoredMatchIds,
  view,
  rows = [],
}: {
  nightId: number;
  scoredMatchIds: number[];
  view: 'stats' | 'advanced';
  rows?: LeaderboardStatLine[];
}) {
  const [data, setData] = useState<ScrimNightStatsView | null>(null);
  const [error, setError] = useState(false);
  // Bumped by the error state's Retry to re-run the fetch.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(false);
    loadStats(nightId, scoredMatchIds)
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
    // The ids' contents, not the array's identity, decide what to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nightId, scoredMatchIds.join(','), attempt]);

  if (!data) return error ? <TabLoadError label={view === 'stats' ? 'stats' : 'advanced stats'} onRetry={() => setAttempt((n) => n + 1)} /> : <TabLoadingSkeleton />;
  if (view === 'stats') return <BasicStatsView rows={rows} matches={data.matches} rounds={data.rounds} />;
  return (
    <SabremetricsLeaderboardView
      rows={data.sabremetrics}
      // Plus stats compare a player with a league-wide baseline, which a handful of players over one night isn't.
      showPlusStats={false}
      kills={data.kills}
      weaponClassStats={data.weaponClassStats}
      economyRows={data.economyStats}
      hasEconomyData={data.economyStats.length > 0}
      matches={data.matches}
      rounds={data.rounds}
      hasSideData={data.matches.length > 0}
    />
  );
}
