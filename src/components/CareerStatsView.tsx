'use client';

import { useMemo, useState } from 'react';
import LeaderboardTable from './LeaderboardTable';
import type { LeaderboardRowWithId } from '@/lib/types';

type Filter = 'career' | number;

function mergeRows(
  a: LeaderboardRowWithId[],
  b: LeaderboardRowWithId[],
): LeaderboardRowWithId[] {
  const map = new Map<number, LeaderboardRowWithId>();
  for (const row of [...a, ...b]) {
    const prev = map.get(row.player_id);
    if (!prev) {
      map.set(row.player_id, { ...row });
      continue;
    }
    const mp = prev.matches_played + row.matches_played;
    const mw = prev.matches_won + row.matches_won;
    const ml = prev.matches_lost + row.matches_lost;
    const rp = prev.total_rounds_played + row.total_rounds_played;
    const rw = prev.total_rounds_won + row.total_rounds_won;
    const kills = prev.total_kills + row.total_kills;
    const deaths = prev.total_deaths + row.total_deaths;
    const td = prev.total_damage + row.total_damage;
    map.set(row.player_id, {
      ...prev,
      season_id: -1,
      matches_played: mp,
      matches_won: mw,
      matches_lost: ml,
      total_kills: kills,
      total_assists: prev.total_assists + row.total_assists,
      total_deaths: deaths,
      total_damage: td,
      total_rounds_played: rp,
      total_rounds_won: rw,
      win_rate_percentage: mp > 0 ? (mw / mp) * 100 : 0,
      kd_ratio: deaths > 0 ? kills / deaths : kills,
      rwr_percentage: rp > 0 ? (rw / rp) * 100 : 0,
      overall_adr: rp > 0 ? td / rp : 0,
    });
  }
  return Array.from(map.values());
}

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
  const [includeRegular, setIncludeRegular] = useState(true);
  const [includeGauntlet, setIncludeGauntlet] = useState(true);
  const [filter, setFilter] = useState<Filter>('career');

  function toggleRegular() {
    if (includeRegular && !includeGauntlet) return; // keep at least one
    setIncludeRegular((v) => !v);
    setFilter('career');
  }

  function toggleGauntlet() {
    if (includeGauntlet && !includeRegular) return; // keep at least one
    setIncludeGauntlet((v) => !v);
    setFilter('career');
  }

  const activeSeasons = useMemo(() => {
    const list: { id: number; name: string }[] = [];
    if (includeRegular) list.push(...regularSeasons);
    if (includeGauntlet) list.push(...gauntletSeasons);
    return list;
  }, [includeRegular, includeGauntlet, regularSeasons, gauntletSeasons]);

  const rows = useMemo<LeaderboardRowWithId[]>(() => {
    if (filter === 'career') {
      if (includeRegular && includeGauntlet) return mergeRows(careerRows, gauntletCareerRows);
      if (includeRegular) return careerRows;
      return gauntletCareerRows;
    }
    // Specific season — look up from whichever source owns that season ID
    const reg = bySeason[filter] ?? [];
    const gnt = gauntletBySeason[filter] ?? [];
    const source = reg.length > 0 ? reg : gnt;
    return source.filter((r) => r.total_rounds_played > 0);
  }, [filter, includeRegular, includeGauntlet, careerRows, gauntletCareerRows, bySeason, gauntletBySeason]);

  return (
    <>
      <div className="flex items-center justify-end gap-5 mb-3">
        <div className="flex items-center gap-5">
          {[
            { label: 'Regular Season', checked: includeRegular, toggle: toggleRegular },
            { label: 'Gauntlets', checked: includeGauntlet, toggle: toggleGauntlet },
          ].map(({ label, checked, toggle }) => (
            <label
              key={label}
              className="flex items-center gap-2 cursor-pointer select-none group"
            >
              <span
                role="checkbox"
                aria-checked={checked}
                tabIndex={0}
                onClick={toggle}
                onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } }}
                className={[
                  'w-4 h-4 border flex-shrink-0 flex items-center justify-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)]',
                  checked
                    ? 'border-[var(--color-text-primary)] bg-[var(--color-text-primary)]'
                    : 'border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]',
                ].join(' ')}
              >
                {checked && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="var(--color-bg-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span
                onClick={toggle}
                className="tracked text-[11px] font-semibold text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors"
              >
                {label}
              </span>
            </label>
          ))}
        </div>
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
        <LeaderboardTable rows={rows} showMedals={false} />
      )}
    </>
  );
}
