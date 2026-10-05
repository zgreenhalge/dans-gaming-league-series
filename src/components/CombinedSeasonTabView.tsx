'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import SeasonTabView, { SEASON_TABS } from './SeasonTabView';
import { resolveTab, useTabState } from './useTabState';
import TopTabBar, { type FeedbackTab } from './TopTabBar';
import { TabLoadingSkeleton, TabLoadError } from './Skeleton';
import type { BracketPod, RegularSeasonLightView, GauntletSeasonLightView, SeasonStatsView } from '@/lib/queries';
import type { LeaderboardRowWithId } from '@/lib/types';

// The two tabs backed by lazily-fetched season data; the Survey/Superlatives tabs (`FeedbackTab`) are
// server-rendered and need no fetching here.
type DataTab = 'regular' | 'gauntlet';
type TopTab = DataTab | FeedbackTab['key'];
const NO_FEEDBACK_TABS: FeedbackTab[] = [];
const TOP_TABS: readonly TopTab[] = ['regular', 'gauntlet', 'survey', 'superlatives'];

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
  feedbackTabs = NO_FEEDBACK_TABS,
}: {
  leaderboard: LeaderboardRowWithId[];
  seasonStartDate: string | null;
  seasonStatus: string;
  /** The regular season's map pool — feeds the Bans/No-picks columns in the Maps & Sides tab. */
  mapPool?: string[] | null;
  gauntletBracketShape: BracketPod[];
  gauntletStatus: string;
  /** Whether any of the gauntlet's matches has a played score — light (`getGauntletSeasonProgress()`),
   *  so it's known before (and regardless of whether) the Gauntlet tab's own light data has loaded. */
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
  initialView: DataTab;
  initialLightData: { kind: 'regular'; data: RegularSeasonLightView } | { kind: 'gauntlet'; data: GauntletSeasonLightView };
  /** The Survey / Superlatives tabs shown after Regular Season and Gauntlet, already rendered by the server. */
  feedbackTabs?: FeedbackTab[];
}) {
  const [rawTopTab, setTopTab] = useTabState(TOP_TABS, initialView, 'view');
  const tabs: { key: TopTab; label: string }[] = [
    { key: 'regular', label: 'Regular Season' },
    { key: 'gauntlet', label: 'Gauntlet' },
    ...feedbackTabs,
  ];
  const topTab = resolveTab(rawTopTab, tabs);
  // Null while a feedback tab is showing — the data effects below have nothing to fetch for those.
  const dataTab: DataTab | null = topTab === 'regular' || topTab === 'gauntlet' ? topTab : null;
  const [subTab, setSubTab] = useTabState(SEASON_TABS, 'leaderboard');

  const [lightCache, setLightCache] = useState<LightCache>(() => ({
    [initialLightData.kind]: initialLightData.data,
  }));
  const [loadingKind, setLoadingKind] = useState<DataTab | null>(null);
  const [loadError, setLoadError] = useState<DataTab | null>(null);
  // Bumped by the error state's "Retry" button to force the effect below to re-run for the same
  // `topTab` — switching away and back would also retry naturally (a fresh `topTab` value re-runs
  // it), but a retry button avoids making that the only way back from a failed fetch.
  const [retryNonce, setRetryNonce] = useState(0);

  // Fetches the active tab's light data the first time it's opened — once cached, switching back to
  // it later is instant (no further network calls for the life of this page view). The Stats/
  // Advanced Stats sub-tabs' own (heavier) data is a separate lazy fetch, owned by SeasonTabView
  // itself rather than this component — see its own fetch effect.
  useEffect(() => {
    if (!dataTab || lightCache[dataTab] || loadingKind === dataTab) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingKind(dataTab);
    setLoadError(null);
    const seasonId = dataTab === 'regular' ? regularSeasonId : gauntletSeasonId;
    fetch(`/api/seasons/${seasonId}/view?kind=${dataTab}&seasonNumber=${seasonNumber ?? ''}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setLightCache((prev) => ({ ...prev, [dataTab]: data }));
      })
      .catch(() => {
        if (!cancelled) setLoadError(dataTab);
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
      setLoadingKind((k) => (k === dataTab ? null : k));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataTab, retryNonce, regularSeasonId, gauntletSeasonId, seasonNumber]);

  const [statsCache, setStatsCache] = useState<StatsCache>({});
  const [statsLoadingKind, setStatsLoadingKind] = useState<DataTab | null>(null);
  const [statsLoadError, setStatsLoadError] = useState<DataTab | null>(null);
  const [statsRetryNonce, setStatsRetryNonce] = useState(0);

  // `subTab` is shared across both top tabs (it doesn't reset on a topTab switch), so it can read
  // 'advanced' while the *active* tab's own light view has no advanced stats at all (e.g. switching
  // from a demo-parsed Regular season into a Gauntlet with none) — SeasonTabView's own resolveTab()
  // would hide that tab immediately, but not before this effect would otherwise have already fired
  // this app's heaviest queries for a payload nothing renders. `undefined` while the active tab's
  // own light view is still loading — re-checked once it resolves via this effect's own dependency
  // on it, rather than skipping forever on a still-unknown answer. No equivalent guard for the
  // (rarer) 'stats' sub-tab, which would need `hasStats`'s own leaderboard/played-match derivation
  // duplicated from SeasonTabView — left to its resolveTab() to hide, at the cost of one wasted
  // fetch in that narrower case.
  const activeHasAdvancedStats = dataTab ? lightCache[dataTab]?.hasAdvancedStats : undefined;

  // The active top tab's Stats/Advanced Stats sub-tab data — a second, separately-lazy tier below
  // the light view above, only fetched once `subTab` is actually 'stats'/'advanced'. Cached here
  // (not inside SeasonTabView, which unmounts on every top-tab switch) so it survives switching
  // away and back the same way `lightCache` above does — passed down as controlled props (see
  // SeasonTabView's own `onStatsRetry` doc comment).
  useEffect(() => {
    if (!dataTab || (subTab !== 'stats' && subTab !== 'advanced') || statsCache[dataTab] || statsLoadingKind === dataTab) return;
    if (subTab === 'advanced' && !activeHasAdvancedStats) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatsLoadingKind(dataTab);
    setStatsLoadError(null);
    const seasonId = dataTab === 'regular' ? regularSeasonId : gauntletSeasonId;
    fetch(`/api/seasons/${seasonId}/stats?kind=${dataTab}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setStatsCache((prev) => ({ ...prev, [dataTab]: data }));
      })
      .catch(() => {
        if (!cancelled) setStatsLoadError(dataTab);
      })
      .finally(() => {
        if (!cancelled) setStatsLoadingKind(null);
      });
    return () => {
      cancelled = true;
      // Same reasoning as the light-view effect's own cleanup above — without this, a switch away
      // before the fetch settles would leave `statsLoadingKind` stuck at this tab forever.
      setStatsLoadingKind((k) => (k === dataTab ? null : k));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, dataTab, statsRetryNonce, regularSeasonId, gauntletSeasonId, activeHasAdvancedStats]);

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
      <TopTabBar tabs={tabs} tab={topTab} setTab={setTopTab} />

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

      {feedbackTabs.find((t) => t.key === topTab)?.content}
    </>
  );
}
