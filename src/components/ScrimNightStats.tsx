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

/** One fetch per night, shared by both tabs and kept across tab switches (the tab bar unmounts the
 *  tab that isn't showing). Each night holds only its latest `version`: when the night's stats change,
 *  the next open replaces it. A failed fetch is dropped so Retry fetches again. */
const statsRequests = new Map<number, { version: string; request: Promise<ScrimNightStatsView> }>();

function loadStats(nightId: number, version: string): Promise<ScrimNightStatsView> {
  const cached = statsRequests.get(nightId);
  if (cached?.version === version) return cached.request;
  const request = fetch(`/api/scrims/${nightId}/stats`).then((res) => {
    if (!res.ok) throw new Error('Failed to load');
    return res.json() as Promise<ScrimNightStatsView>;
  });
  request.catch(() => {
    if (statsRequests.get(nightId)?.request === request) statsRequests.delete(nightId);
  });
  statsRequests.set(nightId, { version, request });
  return request;
}

/** `rows` are the night's totals the Stats view shows; the Advanced view reads its own data.
 *  `version` changes whenever the night's stats could have (`getScrimNightStatsVersion()`), so a fetch
 *  is reused only while it's current. */
export function ScrimNightStats({
  nightId,
  version,
  view,
  rows = [],
}: {
  nightId: number;
  version: string;
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
    loadStats(nightId, version)
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [nightId, version, attempt]);

  // A failed fetch shows its error even over an earlier version's data, rather than leaving it up.
  if (error) return <TabLoadError label={view === 'stats' ? 'stats' : 'advanced stats'} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!data) return <TabLoadingSkeleton />;
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
