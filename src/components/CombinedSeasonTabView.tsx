'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import SeasonTabView, { SEASON_TABS } from './SeasonTabView';
import { useTabState } from './useTabState';
import { tabCls, isPlayedScore } from '@/lib/util';
import type { WeekWithMatches, GauntletRound, BracketPod, H2HData, SabremetricMatchRow, MatchRoundRow, MatchKillRow, WeaponClassMatchRow, EconomyMatchRow } from '@/lib/queries';
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

export default function CombinedSeasonTabView({
  leaderboard,
  schedule,
  seasonStartDate,
  seasonStatus,
  mapPool,
  gauntletRounds,
  gauntletBracketShape,
  gauntletLeaderboard,
  gauntletStatus,
  currentPlayerId,
  isAdmin,
  regularSeasonId,
  h2hData,
  gauntletH2hData,
  ehogRatings,
  gauntletEhogRatings,
  sabremetrics,
  gauntletSabremetrics,
  matchRounds,
  gauntletMatchRounds,
  matchKills,
  gauntletMatchKills,
  matchWeaponClassStats,
  gauntletMatchWeaponClassStats,
  matchEconomyStats,
  gauntletMatchEconomyStats,
}: {
  leaderboard: LeaderboardRowWithId[];
  schedule: WeekWithMatches[];
  seasonStartDate: string | null;
  seasonStatus: string;
  /** The regular season's map pool — feeds the Bans/No-picks columns in the Maps & Sides tab. */
  mapPool?: string[] | null;
  gauntletRounds: GauntletRound[];
  gauntletBracketShape: BracketPod[];
  gauntletLeaderboard: LeaderboardRowWithId[];
  gauntletStatus: string;
  currentPlayerId: number | null;
  isAdmin: boolean;
  /** The paired regular season's own id — the manual bracket editor is always keyed by it, never by
   *  the gauntlet's own id (`/admin/seasons/gauntlet/manual/[id]`). */
  regularSeasonId: number;
  h2hData: H2HData;
  gauntletH2hData: H2HData;
  ehogRatings?: Record<number, number>;
  gauntletEhogRatings?: Record<number, number>;
  sabremetrics?: SabremetricMatchRow[];
  gauntletSabremetrics?: SabremetricMatchRow[];
  matchRounds?: MatchRoundRow[];
  gauntletMatchRounds?: MatchRoundRow[];
  matchKills?: MatchKillRow[];
  gauntletMatchKills?: MatchKillRow[];
  matchWeaponClassStats?: WeaponClassMatchRow[];
  gauntletMatchWeaponClassStats?: WeaponClassMatchRow[];
  matchEconomyStats?: EconomyMatchRow[];
  gauntletMatchEconomyStats?: EconomyMatchRow[];
}) {
  const [topTab, setTopTab] = useTabState(TOP_TABS, 'regular', 'view');
  const [subTab, setSubTab] = useTabState(SEASON_TABS, 'leaderboard');

  // Seed number → player name from the regular season's own standings (already canonical-sorted,
  // i.e. seed order) — lets the gauntlet bracket diagram name an unseeded seed slot before the
  // gauntlet is actually seeded.
  const seedNames = useMemo(
    () => new Map(leaderboard.map((row, i) => [i + 1, row.player_name])),
    [leaderboard],
  );

  // Once any game has a played score, the bracket editor's own materialize-on-save locks a
  // materialized pod anyway — but hiding the link entirely past that point keeps this from reading
  // as an ongoing management surface once the gauntlet is actually underway.
  const gauntletStarted = useMemo(
    () => gauntletRounds.some((r) => r.matches.some((m) => isPlayedScore(m.final_score))),
    [gauntletRounds],
  );

  return (
    <>
      <TopTabBar tab={topTab} setTab={setTopTab} />

      {topTab === 'regular' && (
        <SeasonTabView
          kind="regular"
          leaderboard={leaderboard}
          schedule={schedule}
          seasonStartDate={seasonStartDate}
          seasonStatus={seasonStatus}
          mapPool={mapPool}
          gauntletBracketShape={gauntletBracketShape}
          currentPlayerId={currentPlayerId}
          h2hData={h2hData}
          subStyle
          tab={subTab}
          onTabChange={setSubTab}
          ehogRatings={ehogRatings}
          sabremetrics={sabremetrics}
          matchRounds={matchRounds}
          matchKills={matchKills}
          matchWeaponClassStats={matchWeaponClassStats}
          matchEconomyStats={matchEconomyStats}
        />
      )}

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

      {topTab === 'gauntlet' && (
        <SeasonTabView
          kind="gauntlet"
          leaderboard={gauntletLeaderboard}
          rounds={gauntletRounds}
          bracketShape={gauntletBracketShape}
          seedNames={seedNames}
          seasonStatus={gauntletStatus}
          currentPlayerId={currentPlayerId}
          h2hData={gauntletH2hData}
          subStyle
          tab={subTab}
          onTabChange={setSubTab}
          ehogRatings={gauntletEhogRatings}
          sabremetrics={gauntletSabremetrics}
          matchRounds={gauntletMatchRounds}
          matchKills={gauntletMatchKills}
          matchWeaponClassStats={gauntletMatchWeaponClassStats}
          matchEconomyStats={gauntletMatchEconomyStats}
        />
      )}
    </>
  );
}
