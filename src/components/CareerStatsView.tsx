'use client';

import { useMemo, useState } from 'react';
import LeaderboardTable from './LeaderboardTable';
import type { LeaderboardRowWithId } from '@/lib/types';

type Filter = 'career' | number;

export default function CareerStatsView({
  seasons,
  careerRows,
  bySeason,
}: {
  seasons: { id: number; name: string }[];
  careerRows: LeaderboardRowWithId[];
  bySeason: Record<number, LeaderboardRowWithId[]>;
}) {
  const [filter, setFilter] = useState<Filter>('career');

  const rows = useMemo<LeaderboardRowWithId[]>(() => {
    if (filter === 'career') return careerRows;
    return (bySeason[filter] ?? []).filter((r) => r.total_rounds_played > 0);
  }, [filter, careerRows, bySeason]);

  return (
    <>
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
          {seasons.map((s) => (
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
