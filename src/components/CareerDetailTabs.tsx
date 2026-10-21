'use client';

import { use, useMemo } from 'react';
import EmptyState from './EmptyState';
import H2HSection from './H2HSection';
import { BasicStatsView } from './BasicStatsView';
import SabremetricsLeaderboardView from './SabremetricsLeaderboardView';
import { useLiveH2HData } from './useLiveH2HData';
import { useH2HPairUrlState } from './useH2HPairUrlState';
import { filterByMatchIds } from '@/lib/util';
import type { LeaderboardRowWithId } from '@/lib/types';
import type { StatisticsDetail } from '@/lib/queries';

/** Whether a season's rows fall inside `CareerStatsView`'s current Regular / Gauntlet / season filter. */
export type InSelection = (seasonId: number, isGauntlet: boolean) => boolean;

/**
 * The Statistics page's Stats, Advanced Stats and H2H tabs. They read `detail`, the page's
 * second-tier data, which streams in behind the first paint — suspending here keeps the Leaderboard
 * tab (and the tab bar) interactive while it loads. Filtering by `inSelection` is client-side, so
 * a season-filter change never refetches.
 */
export default function CareerDetailTabs({
  tab,
  detail,
  rows,
  players,
  inSelection,
}: {
  tab: 'stats' | 'advanced' | 'h2h';
  detail: Promise<StatisticsDetail>;
  rows: LeaderboardRowWithId[];
  players: { id: number; name: string; steam_avatar_url: string | null }[];
  inSelection: InSelection;
}) {
  const { allMatches, allSabremetrics, allMatchRounds, allMatchKills, allWeaponClassStats, allEconomyStats } = use(detail);

  const filteredMatches = useMemo(
    () => allMatches.filter((m) => inSelection(m.season_id, m.is_gauntlet)),
    [allMatches, inSelection],
  );
  const filteredSabremetrics = useMemo(
    () => allSabremetrics.filter((r) => inSelection(r.season_id, r.is_gauntlet)),
    [allSabremetrics, inSelection],
  );
  const filteredRounds = useMemo(() => filterByMatchIds(allMatchRounds, filteredMatches), [filteredMatches, allMatchRounds]);
  const filteredKills = useMemo(() => filterByMatchIds(allMatchKills, filteredMatches), [filteredMatches, allMatchKills]);
  const filteredWeaponClassStats = useMemo(
    () => filterByMatchIds(allWeaponClassStats, filteredMatches),
    [filteredMatches, allWeaponClassStats],
  );
  const filteredEconomyStats = useMemo(
    () => filterByMatchIds(allEconomyStats, filteredMatches),
    [filteredMatches, allEconomyStats],
  );

  const h2hData = useLiveH2HData(filteredMatches, players);

  // `h2hData.players`, not the `players` prop — `computeH2H` includes a synthetic fallback entry
  // for any match-referenced player id absent from `players`, so it's a superset of `players`
  // and the same list `H2HSection` itself resolves its clickable rows against; a narrower list here
  // could produce an unresolved id on write.
  const { initialPair: urlInitialPair, onPairChange: handleH2HPairChange } = useH2HPairUrlState(h2hData.players);

  if (tab === 'stats') {
    return rows.length === 0 ? (
      <EmptyState message="No data for this selection." />
    ) : (
      <BasicStatsView rows={rows} matches={filteredMatches} rounds={filteredRounds} />
    );
  }
  if (tab === 'advanced') {
    return (
      <SabremetricsLeaderboardView
        rows={filteredSabremetrics}
        kills={filteredKills}
        weaponClassStats={filteredWeaponClassStats}
        economyRows={filteredEconomyStats}
        hasEconomyData={allEconomyStats.length > 0}
        matches={filteredMatches}
        rounds={filteredRounds}
        hasSideData={allMatches.length > 0}
      />
    );
  }
  return <H2HSection data={h2hData} initialPair={urlInitialPair} onPairChange={handleH2HPairChange} />;
}
