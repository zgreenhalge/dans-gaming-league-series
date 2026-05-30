'use client';

import { useState } from 'react';
import GauntletStandings from './GauntletStandings';
import LeaderboardTable from './LeaderboardTable';
import GauntletRoundsList from './GauntletRoundsList';
import type { GauntletRound } from '@/lib/queries';
import type { LeaderboardRowWithId } from '@/lib/types';

type Tab = 'standings' | 'rounds';

function TabBar({
  tab,
  setTab,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  const tabs: { key: Tab; label: string }[] = [
    { key: 'standings', label: 'Standings' },
    { key: 'rounds', label: 'Rounds' },
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

export default function GauntletTabView({
  rounds,
  leaderboard,
  seasonStatus,
  currentPlayerId,
}: {
  rounds: GauntletRound[];
  leaderboard: LeaderboardRowWithId[];
  seasonStatus: string;
  currentPlayerId: number | null;
}) {
  const [tab, setTab] = useState<Tab>('standings');

  return (
    <>
      <TabBar tab={tab} setTab={setTab} />

      {tab === 'standings' && (
        <>
          <GauntletStandings rounds={rounds} leaderboard={leaderboard} />
          <div className="tracked text-[10px] text-[var(--color-text-secondary)] mt-10 mb-3">
            Stats
          </div>
          {leaderboard.length === 0 ? (
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
              No stats recorded yet.
            </div>
          ) : (
            <LeaderboardTable rows={leaderboard} showMedals={seasonStatus === 'ARCHIVED'} />
          )}
        </>
      )}

      {tab === 'rounds' && (
        <GauntletRoundsList rounds={rounds} currentPlayerId={currentPlayerId} />
      )}
    </>
  );
}
