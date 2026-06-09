'use client';

import { useState } from 'react';
import SeasonTabView from './SeasonTabView';
import { tabCls } from '@/lib/util';
import type { WeekWithMatches, GauntletRound, H2HData } from '@/lib/queries';
import type { LeaderboardRowWithId } from '@/lib/types';

type TopTab = 'regular' | 'gauntlet';

function TopTabBar({ tab, setTab }: { tab: TopTab; setTab: (t: TopTab) => void }) {
  const tabs: { key: TopTab; label: string }[] = [
    { key: 'regular', label: 'Regular Season' },
    { key: 'gauntlet', label: 'Gauntlet' },
  ];
  return (
    <div className="flex border-b border-[var(--color-border-primary)] mb-6">
      {tabs.map((t) => (
        <button
          key={t.key}
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
  gauntletRounds,
  gauntletLeaderboard,
  gauntletStatus,
  currentPlayerId,
  h2hData,
  gauntletH2hData,
}: {
  leaderboard: LeaderboardRowWithId[];
  schedule: WeekWithMatches[];
  seasonStartDate: string | null;
  seasonStatus: string;
  gauntletRounds: GauntletRound[];
  gauntletLeaderboard: LeaderboardRowWithId[];
  gauntletStatus: string;
  currentPlayerId: number | null;
  h2hData: H2HData;
  gauntletH2hData: H2HData;
}) {
  const [topTab, setTopTab] = useState<TopTab>('regular');

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
          currentPlayerId={currentPlayerId}
          h2hData={h2hData}
          subStyle
        />
      )}

      {topTab === 'gauntlet' && (
        <SeasonTabView
          kind="gauntlet"
          leaderboard={gauntletLeaderboard}
          rounds={gauntletRounds}
          seasonStatus={gauntletStatus}
          currentPlayerId={currentPlayerId}
          h2hData={gauntletH2hData}
          subStyle
        />
      )}
    </>
  );
}
