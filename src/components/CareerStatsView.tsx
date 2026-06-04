'use client';

import { useMemo, useState } from 'react';
import LeaderboardTable from './LeaderboardTable';
import { useSeasonFilter, SeasonFilter } from './SeasonFilter';
import { extractSeasonNumber, seasonTitle } from '@/lib/util';
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
  const { includeRegular, includeGauntlet, toggleRegular: baseToggleRegular, toggleGauntlet: baseToggleGauntlet } = useSeasonFilter();
  const [filter, setFilter] = useState<Filter>('career');

  function toggleRegular() { baseToggleRegular(); setFilter('career'); }
  function toggleGauntlet() { baseToggleGauntlet(); setFilter('career'); }

  // Map regular season ID → paired gauntlet season ID (matched by season number)
  const regularToGauntlet = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of regularSeasons) {
      const n = extractSeasonNumber(r.name);
      if (n == null) continue;
      const g = gauntletSeasons.find((s) => extractSeasonNumber(s.name) === n);
      if (g) map.set(r.id, g.id);
    }
    return map;
  }, [regularSeasons, gauntletSeasons]);

  const activeSeasons = useMemo(() => {
    const seen = new Set<string>();
    const all = [
      ...(includeRegular ? regularSeasons : []),
      ...(includeGauntlet ? gauntletSeasons : []),
    ];
    return all.filter((s) => {
      const title = seasonTitle(s.name);
      if (seen.has(title)) return false;
      seen.add(title);
      return true;
    });
  }, [includeRegular, includeGauntlet, regularSeasons, gauntletSeasons]);

  const rows = useMemo<LeaderboardRowWithId[]>(() => {
    if (filter === 'career') {
      if (includeRegular && includeGauntlet) return mergeRows(careerRows, gauntletCareerRows);
      if (includeRegular) return careerRows;
      return gauntletCareerRows;
    }
    const reg = includeRegular
      ? (bySeason[filter] ?? []).filter((r) => r.total_rounds_played > 0)
      : [];
    const pairedGntId = regularToGauntlet.get(filter);
    const gnt = includeGauntlet
      ? ((pairedGntId ? gauntletBySeason[pairedGntId] : gauntletBySeason[filter]) ?? []).filter(
          (r) => r.total_rounds_played > 0,
        )
      : [];
    if (reg.length > 0 && gnt.length > 0) return mergeRows(reg, gnt);
    return reg.length > 0 ? reg : gnt;
  }, [filter, includeRegular, includeGauntlet, careerRows, gauntletCareerRows, bySeason, gauntletBySeason, regularToGauntlet]);

  return (
    <>
      <div className="flex items-center justify-end gap-5 mb-3">
        <SeasonFilter
          filter={{ includeRegular, includeGauntlet, toggleRegular, toggleGauntlet, selectedSeason: 'all' }}
          showRegular={regularSeasons.length > 0}
          showGauntlet={gauntletSeasons.length > 0}
        />
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
              {seasonTitle(s.name)}
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
