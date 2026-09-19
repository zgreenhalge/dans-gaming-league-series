'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import SeasonTabView, { SEASON_TABS } from './SeasonTabView';
import { useTabState } from './useTabState';
import { tabCls } from '@/lib/util';
import { TabLoadingSkeleton, TabLoadError } from './Skeleton';
import type { BracketPod, RegularSeasonLightView, GauntletSeasonLightView, SeasonStatsView } from '@/lib/queries';
import type { LeaderboardRowWithId } from '@/lib/types';

type TopTab = 'regular' | 'gauntlet';
const TOP_TABS: readonly TopTab[] = ['regular', 'gauntlet'];

function TopTabBar({ tab, setTab }: { tab: TopTab; setTab: (t: TopTab) => void }) {
  const tabs: { key: TopTab; label: string }[] = [
    { key: 'regular', label: 'Regular Season' },
    { key: 'gauntlet', label: 'Gauntlet' },
  ];
  return (
    <div role="tablist" className="flex border-b border-[var(--color-border-primary)] mb-6">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={tab === t.key}
          onClick={() => setTab(t.key)}
          className={tabCls(tab === t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

type LightCache = { regular?: RegularSeasonLightView; gauntlet?: GauntletSeasonLightView };
type StatsCache = { regular?: SeasonStatsView; gauntlet?: SeasonStatsView };

export default function CombinedSeasonTabView({
  leaderboard,
  seasonStartDate,
  seasonStatus,
  mapPool,
  gauntletBracketShape,
  gauntletStatus,
  gauntletStarted,
  currentPlayerId,
  isAdmin,
  regularSeasonId,
  gauntletSeasonId,
  seasonNumber,
  initialView,
  initialLightData,
}: {
  leaderboard: LeaderboardRowWithId[];
  seasonStartDate: string | null;
  seasonStatus: string;
  /** The regular season's map pool — feeds the Bans/No-picks columns in the Maps & Sides tab. */
  mapPool?: string[] | null;
  gauntletBracketShape: BracketPod[];
  gauntletStatus: string;
  /** Whether any of the gauntlet's matches has a played score — light (`getGauntletSeasonProgress()`),
   *  so it's known before (and regardless of whether) the Gauntlet tab's own heavy data has loaded. */
  gauntletStarted: boolean;
  currentPlayerId: number | null;
  isAdmin: boolean;
  /** The paired regular season's own id — the manual bracket editor is always keyed by it, never by
   *  the gauntlet's own id (`/admin/seasons/gauntlet/manual/[id]`). */
  regularSeasonId: number;
  gauntletSeasonId: number;
  seasonNumber: number | null;
  /** Which tab the server eagerly fetched light data for — the other tab's light data is fetched
   *  client-side, once, the first time it's actually opened. */
  initialView: TopTab;
  initialLightData: { kind: 'regular'; data: RegularSeasonLightView } | { kind: 'gauntlet'; data: GauntletSeasonLightView };
}) {
  const [topTab, setTopTab] = useTabState(TOP_TABS, initialView, 'view');
  const [subTab, setSubTab] = useTabState(SEASON_TABS, 'leaderboard');

  const [lightCache, setLightCache] = useState<LightCache>(() => ({
    [initialLightData.kind]: initialLightData.data,
  }));
  const [loadingKind, setLoadingKind] = useState<TopTab | null>(null);
  const [loadError, setLoadError] = useState<TopTab | null>(null);
  // Bumped by the error state's "Retry" button to force the effect below to re-run for the same
  // `topTab` — switching away and back would also retry naturally (a fresh `topTab` value re-runs
  // it), but a retry button avoids making that the only way back from a failed fetch.
  const [retryNonce, setRetryNonce] = useState(0);

  // Fetches the active tab's light data the first time it's opened — once cached, switching back to
  // it later is instant (no further network calls for the life of this page view). The Stats/
  // Advanced Stats sub-tabs' own (heavier) data is a separate lazy fetch, owned by SeasonTabView
  // itself rather than this component — see its own fetch effect.
  useEffect(() => {
    if (lightCache[topTab] || loadingKind === topTab) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingKind(topTab);
    setLoadError(null);
    const seasonId = topTab === 'regular' ? regularSeasonId : gauntletSeasonId;
    fetch(`/api/seasons/${seasonId}/view?kind=${topTab}&seasonNumber=${seasonNumber ?? ''}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setLightCache((prev) => ({ ...prev, [topTab]: data }));
      })
      .catch(() => {
        if (!cancelled) setLoadError(topTab);
      })
      .finally(() => {
        if (!cancelled) setLoadingKind(null);
      });
    return () => {
      cancelled = true;
      // A switch away before this fetch settles skips the `!cancelled` branch above, which would
      // otherwise leave `loadingKind` stuck at this tab forever — the guard at the top of this effect
      // would then treat a later switch back as "already loading" and never fetch again. Only clears
      // it if it's still this tab's own (a newer effect run may have already moved it on).
      setLoadingKind((k) => (k === topTab ? null : k));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topTab, retryNonce, regularSeasonId, gauntletSeasonId, seasonNumber]);

  const [statsCache, setStatsCache] = useState<StatsCache>({});
  const [statsLoadingKind, setStatsLoadingKind] = useState<TopTab | null>(null);
  const [statsLoadError, setStatsLoadError] = useState<TopTab | null>(null);
  const [statsRetryNonce, setStatsRetryNonce] = useState(0);

  // The active top tab's Stats/Advanced Stats sub-tab data — a second, separately-lazy tier below
  // the light view above, only fetched once `subTab` is actually 'stats'/'advanced'. Cached here
  // (not inside SeasonTabView, which unmounts on every top-tab switch) so it survives switching
  // away and back the same way `lightCache` above does — passed down as controlled props (see
  // SeasonTabView's own `onStatsRetry` doc comment).
  useEffect(() => {
    if ((subTab !== 'stats' && subTab !== 'advanced') || statsCache[topTab] || statsLoadingKind === topTab) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatsLoadingKind(topTab);
    setStatsLoadError(null);
    const seasonId = topTab === 'regular' ? regularSeasonId : gauntletSeasonId;
    fetch(`/api/seasons/${seasonId}/stats?kind=${topTab}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setStatsCache((prev) => ({ ...prev, [topTab]: data }));
      })
      .catch(() => {
        if (!cancelled) setStatsLoadError(topTab);
      })
      .finally(() => {
        if (!cancelled) setStatsLoadingKind(null);
      });
    return () => {
      cancelled = true;
      // Same reasoning as the light-view effect's own cleanup above — without this, a switch away
      // before the fetch settles would leave `statsLoadingKind` stuck at this tab forever.
      setStatsLoadingKind((k) => (k === topTab ? null : k));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, topTab, statsRetryNonce, regularSeasonId, gauntletSeasonId]);

  // Seed number → player name from the regular season's own standings (already canonical-sorted,
  // i.e. seed order) — lets the gauntlet bracket diagram name an unseeded seed slot before the
  // gauntlet is actually seeded.
  const seedNames = useMemo(
    () => new Map(leaderboard.map((row, i) => [i + 1, row.player_name])),
    [leaderboard],
  );

  const regularData = lightCache.regular;
  const gauntletData = lightCache.gauntlet;

  return (
    <>
      <TopTabBar tab={topTab} setTab={setTopTab} />

      {topTab === 'regular' &&
        (regularData ? (
          <SeasonTabView
            kind="regular"
            leaderboard={leaderboard}
            schedule={regularData.schedule}
            seasonStartDate={seasonStartDate}
            seasonStatus={seasonStatus}
            mapPool={mapPool}
            gauntletBracketShape={gauntletBracketShape}
            currentPlayerId={currentPlayerId}
            h2hData={regularData.h2hData}
            subStyle
            tab={subTab}
            onTabChange={setSubTab}
            ehogRatings={regularData.ehogRatings}
            hasAdvancedStats={regularData.hasAdvancedStats}
            statsData={statsCache.regular}
            statsError={statsLoadError === 'regular'}
            onStatsRetry={() => setStatsRetryNonce((n) => n + 1)}
          />
        ) : loadError === 'regular' ? (
          <TabLoadError label="regular season stats" onRetry={() => setRetryNonce((n) => n + 1)} />
        ) : (
          <TabLoadingSkeleton />
        ))}

      {topTab === 'gauntlet' && isAdmin && !gauntletStarted && (
        <div className="mb-4">
          <Link
            href={`/admin/seasons/gauntlet/manual/${regularSeasonId}`}
            className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] underline decoration-dotted"
          >
            Manage Bracket →
          </Link>
        </div>
      )}

      {topTab === 'gauntlet' &&
        (gauntletData ? (
          <SeasonTabView
            kind="gauntlet"
            leaderboard={gauntletData.leaderboard}
            rounds={gauntletData.rounds}
            bracketShape={gauntletBracketShape}
            seedNames={seedNames}
            seasonStatus={gauntletStatus}
            currentPlayerId={currentPlayerId}
            h2hData={gauntletData.h2hData}
            subStyle
            tab={subTab}
            onTabChange={setSubTab}
            ehogRatings={gauntletData.ehogRatings}
            hasAdvancedStats={gauntletData.hasAdvancedStats}
            statsData={statsCache.gauntlet}
            statsError={statsLoadError === 'gauntlet'}
            onStatsRetry={() => setStatsRetryNonce((n) => n + 1)}
          />
        ) : loadError === 'gauntlet' ? (
          <TabLoadError label="gauntlet stats" onRetry={() => setRetryNonce((n) => n + 1)} />
        ) : (
          <TabLoadingSkeleton />
        ))}
    </>
  );
}
