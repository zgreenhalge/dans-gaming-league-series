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

type Player = { id: number; name: string; steam_avatar_url: string | null };

/**
 * The Statistics page's Stats, Advanced Stats and H2H tabs. They read `detail`, the page's
 * second-tier data, which streams in behind the first paint — suspending here keeps the Leaderboard
 * tab (and the tab bar) interactive while it loads. Filtering by `inSelection` is client-side, so
 * a season-filter change never refetches. Each tab derives only the slices it renders.
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
  players: Player[];
  inSelection: InSelection;
}) {
  const data = use(detail);
  if (tab === 'stats') return <StatsTab data={data} rows={rows} inSelection={inSelection} />;
  if (tab === 'advanced') return <AdvancedTab data={data} inSelection={inSelection} />;
  return <H2HTab data={data} players={players} inSelection={inSelection} />;
}

/** The detail data's matches inside the current selection — the filter every tab's slices follow. */
function useSelectedMatches({ allMatches }: StatisticsDetail, inSelection: InSelection) {
  return useMemo(() => allMatches.filter((m) => inSelection(m.season_id, m.is_gauntlet)), [allMatches, inSelection]);
}

function StatsTab({ data, rows, inSelection }: { data: StatisticsDetail; rows: LeaderboardRowWithId[]; inSelection: InSelection }) {
  const matches = useSelectedMatches(data, inSelection);
  const rounds = useMemo(() => filterByMatchIds(data.allMatchRounds, matches), [data.allMatchRounds, matches]);
  if (rows.length === 0) return <EmptyState message="No data for this selection." />;
  return <BasicStatsView rows={rows} matches={matches} rounds={rounds} />;
}

function AdvancedTab({ data, inSelection }: { data: StatisticsDetail; inSelection: InSelection }) {
  const matches = useSelectedMatches(data, inSelection);
  const sabremetrics = useMemo(
    () => data.allSabremetrics.filter((r) => inSelection(r.season_id, r.is_gauntlet)),
    [data.allSabremetrics, inSelection],
  );
  const rounds = useMemo(() => filterByMatchIds(data.allMatchRounds, matches), [data.allMatchRounds, matches]);
  const kills = useMemo(() => filterByMatchIds(data.allMatchKills, matches), [data.allMatchKills, matches]);
  const weaponClassStats = useMemo(() => filterByMatchIds(data.allWeaponClassStats, matches), [data.allWeaponClassStats, matches]);
  const economyRows = useMemo(() => filterByMatchIds(data.allEconomyStats, matches), [data.allEconomyStats, matches]);
  return (
    <SabremetricsLeaderboardView
      rows={sabremetrics}
      kills={kills}
      weaponClassStats={weaponClassStats}
      economyRows={economyRows}
      hasEconomyData={data.allEconomyStats.length > 0}
      matches={matches}
      rounds={rounds}
      hasSideData={data.allMatches.length > 0}
    />
  );
}

function H2HTab({ data, players, inSelection }: { data: StatisticsDetail; players: Player[]; inSelection: InSelection }) {
  const matches = useSelectedMatches(data, inSelection);
  const h2hData = useLiveH2HData(matches, players);
  // `h2hData.players`, not the `players` prop — `computeH2H` includes a synthetic fallback entry
  // for any match-referenced player id absent from `players`, so it's a superset of `players`
  // and the same list `H2HSection` itself resolves its clickable rows against; a narrower list here
  // could produce an unresolved id on write.
  const { initialPair, onPairChange } = useH2HPairUrlState(h2hData.players);
  return <H2HSection data={h2hData} initialPair={initialPair} onPairChange={onPairChange} />;
}
