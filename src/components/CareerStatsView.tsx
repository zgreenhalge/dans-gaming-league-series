'use client';

import { useMemo, useState } from 'react';
import LeaderboardTable from './LeaderboardTable';
import type { LeaderboardRowWithId } from '@/lib/types';

type Mode = 'regular' | 'gauntlet';
type Filter = 'career' | number;

export default function CareerStatsView({
  regularSeasons,
  gauntletSeasons,
  careerRows,
  bySeason,
  gauntletCareerRows,
  gauntletBySeason,
}: {
  regularSeasons: { id: number; name: string }[];
  gauntletSeasons: { id: number; name: string }[];
  careerRows: LeaderboardRowWithId[];
  bySeason: Record<number, LeaderboardRowWithId[]>;
  gauntletCareerRows: LeaderboardRowWithId[];
  gauntletBySeason: Record<number, LeaderboardRowWithId[]>;
}) {
  const [mode, setMode] = useState<Mode>('regular');
  const [filter, setFilter] = useState<Filter>('career');

  const activeSeasons = mode === 'regular' ? regularSeasons : gauntletSeasons;
  const activeCareer = mode === 'regular' ? careerRows : gauntletCareerRows;
  const activeByseason = mode === 'regular' ? bySeason : gauntletBySeason;

  const rows = useMemo<LeaderboardRowWithId[]>(() => {
    if (filter === 'career') return activeCareer;
    return (activeByseason[filter] ?? []).filter((r) => r.total_rounds_played > 0);
  }, [filter, activeCareer, activeByseason]);

  function switchMode(next: Mode) {
    setMode(next);
    setFilter('career');
  }

  return (
    <>
      <div className="flex items-center gap-1 mb-5">
        {(['regular', 'gauntlet'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className={[
              'tracked text-[11px] font-semibold px-3 py-1 border transition-colors',
              mode === m
                ? 'border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-bg-primary)]'
                : 'border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            ].join(' ')}
          >
            {m === 'regular' ? 'Regular Season' : 'Gauntlets'}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="tracked text-[10px] text-[var(--color-text-secondary)]">
          Showing
        </span>
        <select
          value={String(filter)}
          onChange={(e) => {
            const v = e.target.value;
            setFilter(v === 'career' ? 'career' : Number(v));
          }}
          className="tracked text-[11px] font-semibold border border-[var(--color-border-primary)] px-2.5 py-1 bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] cursor-pointer hover:bg-[var(--color-bg-secondary)] transition-colors"
        >
          <option value="career">Career</option>
          {activeSeasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
          No data for this selection.
        </div>
      ) : (
        <LeaderboardTable rows={rows} />
      )}
    </>
  );
}
