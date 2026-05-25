'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { LeaderboardRowWithId } from '@/lib/types';

type SortCol =
  | 'name'
  | 'record'
  | 'wr'
  | 'rw_rl'
  | 'rwr'
  | 'kills'
  | 'assists'
  | 'deaths'
  | 'kd'
  | 'adr';

function compare(
  a: LeaderboardRowWithId,
  b: LeaderboardRowWithId,
  col: SortCol,
): number {
  switch (col) {
    case 'name':
      return a.player_name.localeCompare(b.player_name);
    case 'record':
      return b.matches_won - a.matches_won || a.matches_lost - b.matches_lost;
    case 'wr':
      return (
        b.win_rate_percentage - a.win_rate_percentage ||
        b.rwr_percentage - a.rwr_percentage
      );
    case 'rw_rl':
      return b.total_rounds_won - a.total_rounds_won;
    case 'rwr':
      return b.rwr_percentage - a.rwr_percentage;
    case 'kills':
      return b.total_kills - a.total_kills;
    case 'assists':
      return b.total_assists - a.total_assists;
    case 'deaths':
      return a.total_deaths - b.total_deaths;
    case 'kd':
      return b.kd_ratio - a.kd_ratio;
    case 'adr':
      return b.overall_adr - a.overall_adr;
  }
}

// In 'season' mode: first col shows season name linking to /seasons/[season_id].
// In 'player' mode: first col shows rank + player name linking to /players/[player_id].
export default function LeaderboardTable({
  rows,
  firstColMode = 'player',
  showMedals = true,
}: {
  rows: LeaderboardRowWithId[];
  firstColMode?: 'player' | 'season';
  showMedals?: boolean;
}) {
  const [sortCol, setSortCol] = useState<SortCol>('wr');
  const [asc, setAsc] = useState(false);

  function clickHeader(col: SortCol) {
    if (col === sortCol) setAsc(!asc);
    else {
      setSortCol(col);
      setAsc(col === 'name');
    }
  }

  function headerKey(e: React.KeyboardEvent, col: SortCol) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      clickHeader(col);
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const v = compare(a, b, sortCol);
    return asc ? -v : v;
  });

  // Canonical medal positions: WR% → RWR% → ADR, fixed regardless of active sort.
  const medalRank = new Map<number, 1 | 2 | 3>();
  if (showMedals && firstColMode === 'player') {
    [...rows]
      .sort(
        (a, b) =>
          b.win_rate_percentage - a.win_rate_percentage ||
          b.rwr_percentage - a.rwr_percentage ||
          b.overall_adr - a.overall_adr,
      )
      .slice(0, 3)
      .forEach((r, i) => medalRank.set(r.player_id, (i + 1) as 1 | 2 | 3));
  }

  const MEDAL_COLORS: Record<1 | 2 | 3, string> = {
    1: '#f5c542',          // gold
    2: '#a0a3ab',          // silver
    3: '#c47a3a',          // bronze
  };

  const dash = (played: boolean, v: string) =>
    played ? v : <span className="text-[var(--color-text-secondary)]">—</span>;

  const firstColLabel = firstColMode === 'season' ? 'Season' : 'Player';

  const STAT_COLS: { key: SortCol; label: string }[] = [
    { key: 'record', label: 'W-L' },
    { key: 'wr',     label: 'WR%' },
    { key: 'rw_rl',  label: 'RW-RL' },
    { key: 'rwr',    label: 'RWR%' },
    { key: 'kills',   label: 'Kills' },
    { key: 'assists', label: 'Assists' },
    { key: 'deaths',  label: 'Deaths' },
    { key: 'kd',      label: 'K/D' },
    { key: 'adr',     label: 'ADR' },
  ];

  function SortableTh({ col }: { col: { key: SortCol; label: string } }) {
    const active = sortCol === col.key;
    return (
      <th
        role="button"
        tabIndex={0}
        aria-sort={active ? (asc ? 'ascending' : 'descending') : 'none'}
        onClick={() => clickHeader(col.key)}
        onKeyDown={(e) => headerKey(e, col.key)}
        className={`tracked text-[10px] font-semibold py-2.5 px-2 border-b border-[var(--color-border-primary)] cursor-pointer select-none whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)] text-right ${
          active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
        }`}
      >
        {col.label}
        <span className={`ml-1 ${active ? 'opacity-100' : 'opacity-30'}`}>
          {active ? (asc ? '↑' : '↓') : '↕'}
        </span>
      </th>
    );
  }

  return (
    <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-[var(--color-bg-secondary)]">
            {firstColMode === 'player' && (
              <th className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-left pl-4 pr-2 py-2.5 border-b border-[var(--color-border-primary)] w-6">
                #
              </th>
            )}
            <th
              role="button"
              tabIndex={0}
              aria-sort={sortCol === 'name' ? (asc ? 'ascending' : 'descending') : 'none'}
              onClick={() => clickHeader('name')}
              onKeyDown={(e) => headerKey(e, 'name')}
              className={`tracked text-[10px] font-semibold py-2.5 border-b border-[var(--color-border-primary)] cursor-pointer select-none whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)] text-left ${
                firstColMode === 'player' ? 'px-2' : 'pl-4 pr-2'
              } ${sortCol === 'name' ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
            >
              {firstColLabel}
              <span className={`ml-1 ${sortCol === 'name' ? 'opacity-100' : 'opacity-30'}`}>
                {sortCol === 'name' ? (asc ? '↑' : '↓') : '↕'}
              </span>
            </th>
            {STAT_COLS.map((c) => <SortableTh key={c.key} col={c} />)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => {
            const played = p.total_rounds_played > 0;
            const rounds_lost = p.total_rounds_played - p.total_rounds_won;
            const medal = medalRank.get(p.player_id);
            const href = firstColMode === 'season'
              ? `/seasons/${p.season_id}`
              : `/players/${p.player_id}`;
            return (
              <tr
                key={firstColMode === 'season' ? p.season_id : p.player_id}
                className="border-b border-[var(--color-border-tertiary)] last:border-b-0 cursor-pointer transition-colors"
                style={medal
                  ? { background: `color-mix(in srgb, ${MEDAL_COLORS[medal]} 8%, var(--color-bg-primary))` }
                  : undefined
                }
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = medal ? `color-mix(in srgb, ${MEDAL_COLORS[medal]} 14%, var(--color-bg-primary))` : 'var(--color-bg-secondary)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = medal ? `color-mix(in srgb, ${MEDAL_COLORS[medal]} 8%, var(--color-bg-primary))` : ''; }}
              >
                {firstColMode === 'player' && (
                  <td className="pl-4 pr-2 py-2.5 font-mono text-[11px] tnum"
                    style={{ color: medal ? MEDAL_COLORS[medal] : 'var(--color-text-secondary)' }}
                  >
                    <Link href={href} className="block w-full h-full">{i + 1}</Link>
                  </td>
                )}
                <td className={`py-2.5 font-display font-semibold ${firstColMode === 'player' ? 'px-2' : 'pl-4 pr-2'}`}
                  style={{ color: medal ? MEDAL_COLORS[medal] : undefined }}
                >
                  <Link href={href} className="block w-full h-full">{p.player_name}</Link>
                </td>
                <td className="py-2.5 px-2 text-right font-mono tnum">
                  <Link href={href} className="block w-full h-full">{dash(played, `${p.matches_won}-${p.matches_lost}`)}</Link>
                </td>
                <td className="py-2.5 px-2 text-right font-mono tnum">
                  <Link href={href} className="block w-full h-full">{dash(played, `${p.win_rate_percentage.toFixed(1)}%`)}</Link>
                </td>
                <td className="py-2.5 px-2 text-right font-mono tnum">
                  <Link href={href} className="block w-full h-full">{dash(played, `${p.total_rounds_won}-${rounds_lost}`)}</Link>
                </td>
                <td className="py-2.5 px-2 text-right font-mono tnum">
                  <Link href={href} className="block w-full h-full">{dash(played, `${p.rwr_percentage.toFixed(1)}%`)}</Link>
                </td>
                <td className="py-2.5 px-2 text-right font-mono tnum">
                  <Link href={href} className="block w-full h-full">{dash(played, String(p.total_kills))}</Link>
                </td>
                <td className="py-2.5 px-2 text-right font-mono tnum">
                  <Link href={href} className="block w-full h-full">{dash(played, String(p.total_assists))}</Link>
                </td>
                <td className="py-2.5 px-2 text-right font-mono tnum">
                  <Link href={href} className="block w-full h-full">{dash(played, String(p.total_deaths))}</Link>
                </td>
                <td className="py-2.5 px-2 text-right font-mono tnum">
                  <Link href={href} className="block w-full h-full">{dash(played, p.kd_ratio.toFixed(2))}</Link>
                </td>
                <td className="py-2.5 pr-4 pl-2 text-right font-mono tnum font-semibold">
                  <Link href={href} className="block w-full h-full">{dash(played, p.overall_adr.toFixed(1))}</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
