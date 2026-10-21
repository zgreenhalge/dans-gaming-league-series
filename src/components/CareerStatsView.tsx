'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import EmptyState from './EmptyState';
import LeaderboardTable from './LeaderboardTable';
import { useSeasonFilter, CareerSeasonControls } from './SeasonFilter';
import { useTabState } from './useTabState';
import CareerDetailTabs from './CareerDetailTabs';
import ErrorBoundary from './ErrorBoundary';
import { TabLoadingSkeleton, TabLoadError } from './Skeleton';
import { buildRegularToGauntletMap, extractSeasonNumber, mergeLeaderboardRows, tabCls } from '@/lib/util';
import type { LeaderboardRowWithId } from '@/lib/types';
import type { TrophyEntry, EhogSnapshotRow, StatisticsDetail } from '@/lib/queries';
import EhogTierBar from './EhogTierBar';
import TabBar from './TabBar';

type Tab = 'leaderboard' | 'stats' | 'advanced' | 'h2h';

const CAREER_TABS: readonly Tab[] = ['leaderboard', 'stats', 'advanced', 'h2h'];

export default function CareerStatsView({
  regularSeasons,
  gauntletSeasons,
  careerRows,
  bySeason,
  gauntletCareerRows,
  gauntletBySeason,
  trophiesByPlayer,
  players,
  ehogSnapshots = [],
  detail,
}: {
  regularSeasons: { id: number; name: string }[];
  gauntletSeasons: { id: number; name: string }[];
  careerRows: LeaderboardRowWithId[];
  bySeason: Record<number, LeaderboardRowWithId[]>;
  gauntletCareerRows: LeaderboardRowWithId[];
  gauntletBySeason: Record<number, LeaderboardRowWithId[]>;
  trophiesByPlayer: Record<number, TrophyEntry[]>;
  players: { id: number; name: string; steam_avatar_url: string | null }[];
  ehogSnapshots?: EhogSnapshotRow[];
  /** The Stats, Advanced Stats and H2H tabs' data, still loading while the Leaderboard tab renders. */
  detail: Promise<StatisticsDetail>;
}) {
  const { includeRegular, includeGauntlet, selectedSeason, toggleRegular, toggleGauntlet, setSelectedSeason } = useSeasonFilter({ regularSeasons, gauntletSeasons });
  const [tab, setTab] = useTabState(CAREER_TABS, 'leaderboard');
  const [hoveredPlayerId, setHoveredPlayerId] = useState<number | null>(null);

  // Map regular season ID → paired gauntlet season ID (matched by season number)
  const regularToGauntlet = useMemo(
    () => buildRegularToGauntletMap(regularSeasons, gauntletSeasons),
    [regularSeasons, gauntletSeasons],
  );

  const rows = useMemo<LeaderboardRowWithId[]>(() => {
    if (selectedSeason === 'all') {
      if (includeRegular && includeGauntlet) return mergeLeaderboardRows(careerRows, gauntletCareerRows);
      if (includeRegular) return careerRows;
      return gauntletCareerRows;
    }
    const reg = includeRegular ? (bySeason[selectedSeason] ?? []) : [];
    const pairedGntId = regularToGauntlet.get(selectedSeason);
    const gnt = includeGauntlet
      ? (pairedGntId ? gauntletBySeason[pairedGntId] : gauntletBySeason[selectedSeason]) ?? []
      : [];
    if (reg.length > 0 && gnt.length > 0) return mergeLeaderboardRows(reg, gnt);
    return reg.length > 0 ? reg : gnt;
  }, [selectedSeason, includeRegular, includeGauntlet, careerRows, gauntletCareerRows, bySeason, gauntletBySeason, regularToGauntlet]);

  // Whether a row of `seasonId` is inside the current Regular / Gauntlet / season filter — the one
  // rule the detail tabs filter their per-match rows by.
  const inSelection = useCallback(
    (seasonId: number, isGauntlet: boolean) => {
      if (selectedSeason === 'all' || seasonId === selectedSeason) return isGauntlet ? includeGauntlet : includeRegular;
      return includeGauntlet && seasonId === regularToGauntlet.get(selectedSeason);
    },
    [selectedSeason, includeRegular, includeGauntlet, regularToGauntlet],
  );

  const trophyCounts = useMemo(() => {
    const counts = new Map<number, Record<1 | 2 | 3, number>>();
    for (const [pidStr, entries] of Object.entries(trophiesByPlayer)) {
      const matching = entries.filter((t) => inSelection(t.season_id, t.is_gauntlet));
      const c: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
      for (const t of matching) c[t.rank]++;
      counts.set(Number(pidStr), c);
    }
    return counts;
  }, [trophiesByPlayer, inSelection]);

  const ehogRatings = useMemo<Record<number, number>>(() => {
    const filtered = selectedSeason === 'all'
      ? ehogSnapshots.filter((s) => s.isGauntlet ? includeGauntlet : includeRegular)
      : (() => {
          const sel = regularSeasons.find((rs) => rs.id === selectedSeason);
          const sn = sel ? extractSeasonNumber(sel.name) : null;
          return ehogSnapshots.filter((s) => s.seasonNumber === sn && (s.isGauntlet ? includeGauntlet : includeRegular));
        })();
    const latest: Record<number, { rating: number; seq: number }> = {};
    for (const s of filtered) {
      const prev = latest[s.playerId];
      if (!prev || s.sequenceIndex > prev.seq) {
        latest[s.playerId] = { rating: s.ehogRating, seq: s.sequenceIndex };
      }
    }
    const result: Record<number, number> = {};
    for (const [pid, val] of Object.entries(latest)) result[Number(pid)] = val.rating;
    return result;
  }, [ehogSnapshots, selectedSeason, includeRegular, includeGauntlet, regularSeasons]);

  return (
    <>
      <TabBar
        bordered
        className="mb-3"
        controls={
          (tab === 'leaderboard' || tab === 'stats' || tab === 'advanced' || tab === 'h2h') ? (
            <CareerSeasonControls
              includeRegular={includeRegular}
              includeGauntlet={includeGauntlet}
              toggleRegular={toggleRegular}
              toggleGauntlet={toggleGauntlet}
              regularSeasons={regularSeasons}
              gauntletSeasons={gauntletSeasons}
              selectedSeason={selectedSeason}
              setSelectedSeason={setSelectedSeason}
            />
          ) : undefined
        }
      >
        <button role="tab" aria-selected={tab === 'leaderboard'} className={tabCls(tab === 'leaderboard')} onClick={() => setTab('leaderboard')}>
          Leaderboard
        </button>
        <button role="tab" aria-selected={tab === 'stats'} className={tabCls(tab === 'stats')} onClick={() => setTab('stats')}>
          Stats
        </button>
        <button role="tab" aria-selected={tab === 'advanced'} className={tabCls(tab === 'advanced')} onClick={() => setTab('advanced')}>
          Advanced Stats
        </button>
        <button role="tab" aria-selected={tab === 'h2h'} className={tabCls(tab === 'h2h')} onClick={() => setTab('h2h')}>
          H2H
        </button>
      </TabBar>

      {tab === 'leaderboard' && (
        rows.length === 0 ? (
          <EmptyState message="No data for this selection." />
        ) : (
          <>
            <div className="mb-4">
              <EhogTierBar
                players={rows
                  .filter((r) => ehogRatings[r.player_id] != null)
                  .map((r) => ({ id: r.player_id, name: r.player_name, rating: ehogRatings[r.player_id] }))}
                highlightPlayerId={hoveredPlayerId}
              />
            </div>
            <LeaderboardTable rows={rows} showMedals={false} showRank={false} trophyCounts={trophyCounts} ehogRatings={ehogRatings} onPlayerHover={setHoveredPlayerId} />
          </>
        )
      )}

      {tab !== 'leaderboard' && (
        <ErrorBoundary fallback={<TabLoadError label="these stats" onRetry={() => window.location.reload()} />}>
          <Suspense fallback={<TabLoadingSkeleton />}>
            <CareerDetailTabs tab={tab} detail={detail} rows={rows} players={players} inSelection={inSelection} />
          </Suspense>
        </ErrorBoundary>
      )}
    </>
  );
}

