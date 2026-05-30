'use client';

import { useState } from 'react';
import SeasonTabView from './SeasonTabView';
import type { WeekWithMatches, GauntletRound } from '@/lib/queries';
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
          className={`px-4 py-2.5 tracked text-[11px] font-semibold transition-colors -mb-px border-b-2 ${
            tab === t.key
              ? 'text-[var(--color-text-primary)] border-[var(--color-text-primary)]'
              : 'text-[var(--color-text-secondary)] border-transparent hover:text-[var(--color-text-primary)]'
          }`}
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
}: {
  leaderboard: LeaderboardRowWithId[];
  schedule: WeekWithMatches[];
  seasonStartDate: string | null;
  seasonStatus: string;
  gauntletRounds: GauntletRound[];
  gauntletLeaderboard: LeaderboardRowWithId[];
  gauntletStatus: string;
  currentPlayerId: number | null;
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
          subStyle
        />
      )}
    </>
  );
}
