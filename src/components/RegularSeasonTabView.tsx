'use client';

import { useState } from 'react';
import LeaderboardTable from './LeaderboardTable';
import ScheduleList from './ScheduleList';
import type { WeekWithMatches } from '@/lib/queries';
import type { LeaderboardRowWithId } from '@/lib/types';

type Tab = 'leaderboard' | 'schedule';

function TabBar({
  tab,
  setTab,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  const tabs: { key: Tab; label: string }[] = [
    { key: 'leaderboard', label: 'Leaderboard' },
    { key: 'schedule', label: 'Schedule' },
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

export default function RegularSeasonTabView({
  leaderboard,
  schedule,
  seasonStartDate,
  seasonStatus,
  currentPlayerId,
}: {
  leaderboard: LeaderboardRowWithId[];
  schedule: WeekWithMatches[];
  seasonStartDate: string | null;
  seasonStatus: string;
  currentPlayerId: number | null;
}) {
  const [tab, setTab] = useState<Tab>('leaderboard');

  return (
    <>
      <TabBar tab={tab} setTab={setTab} />

      {tab === 'leaderboard' && (
        leaderboard.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            No leaderboard data yet.
          </div>
        ) : (
          <LeaderboardTable
            rows={leaderboard}
            showMedals={seasonStatus === 'ARCHIVED'}
            playoffZones={seasonStatus === 'ACTIVE' ? { top: 2, bottom: 4 } : undefined}
          />
        )
      )}

      {tab === 'schedule' && (
        <ScheduleList
          schedule={schedule}
          seasonStartDate={seasonStartDate}
          currentPlayerId={currentPlayerId}
        />
      )}
    </>
  );
}
