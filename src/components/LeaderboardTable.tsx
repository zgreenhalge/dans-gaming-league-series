'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import type { LeaderboardRowWithId } from '@/lib/types';
import { PlayerName } from './PlayerName';
import { canonicalSort } from '@/lib/util';
import { ehogColorFor } from './EhogBadge';

type SortCol =
  | 'name'
  | 'gold'
  | 'silver'
  | 'bronze'
  | 'rank'
  | 'gp'
  | 'wr'
  | 'rwr'
  | 'adr'
  | 'ehog';

function compare(
  a: LeaderboardRowWithId,
  b: LeaderboardRowWithId,
  col: SortCol,
  trophyCounts?: Map<number, Record<1 | 2 | 3, number>>,
  canonicalRanking?: Map<number, number>,
  ehogRatings?: Record<number, number>,
): number {
  switch (col) {
    case 'rank':
      return (canonicalRanking?.get(a.player_id) ?? 999) - (canonicalRanking?.get(b.player_id) ?? 999);
    case 'gold':
      return (
        ((trophyCounts?.get(b.player_id)?.[1] ?? 0) - (trophyCounts?.get(a.player_id)?.[1] ?? 0)) ||
        ((trophyCounts?.get(b.player_id)?.[2] ?? 0) - (trophyCounts?.get(a.player_id)?.[2] ?? 0)) ||
        ((trophyCounts?.get(b.player_id)?.[3] ?? 0) - (trophyCounts?.get(a.player_id)?.[3] ?? 0))
      );
    case 'silver':
      return (trophyCounts?.get(b.player_id)?.[2] ?? 0) - (trophyCounts?.get(a.player_id)?.[2] ?? 0);
    case 'bronze':
      return (trophyCounts?.get(b.player_id)?.[3] ?? 0) - (trophyCounts?.get(a.player_id)?.[3] ?? 0);
    case 'name':
      return a.player_name.localeCompare(b.player_name);
    case 'wr':
      return (
        b.win_rate_percentage - a.win_rate_percentage ||
        b.rwr_percentage - a.rwr_percentage
      );
    case 'rwr':
      return b.rwr_percentage - a.rwr_percentage;
    case 'gp':
      return b.matches_played - a.matches_played;
    case 'adr':
      return b.overall_adr - a.overall_adr;
    case 'ehog':
      return (ehogRatings?.[b.player_id] ?? -1) - (ehogRatings?.[a.player_id] ?? -1);
  }
}

// In 'season' mode: first col shows season name linking to /seasons/[season_id].
// In 'player' mode: first col shows rank + player name linking to /players/[player_id].
export default function LeaderboardTable({
  rows,
  firstColMode = 'player',
  showMedals = true,
  showRank = true,
  playoffZones,
  trophyCounts,
  canonicalRanking,
  ehogRatings,
  onPlayerHover,
}: {
  rows: LeaderboardRowWithId[];
  firstColMode?: 'player' | 'season';
  showMedals?: boolean;
  showRank?: boolean;
  playoffZones?: { top: number; bottom: number };
  trophyCounts?: Map<number, Record<1 | 2 | 3, number>>;
  canonicalRanking?: Map<number, number>;
  ehogRatings?: Record<number, number>;
  onPlayerHover?: (playerId: number | null) => void;
}) {
  const { data: session } = useSession();
  const myPlayerId = session?.user?.playerId ?? null;

  const defaultSort: SortCol = trophyCounts ? 'gold' : canonicalRanking ? 'rank' : 'wr';
  const [sortCol, setSortCol] = useState<SortCol>(defaultSort);
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
    const v = compare(a, b, sortCol, trophyCounts, canonicalRanking, ehogRatings);
    return asc ? -v : v;
  });

  // Canonical rank for the # column: use the provided gauntlet ranking when available,
  // otherwise fall back to WR% → RWR% → ADR.
  const canonicalRankOf: Map<number, number> = canonicalRanking
    ? canonicalRanking
    : new Map([...rows].sort(canonicalSort).map((r, i) => [r.player_id, i + 1]));

  // Playoff zone coloring: top N gold, bottom N red tint (overrides medals when provided)
  const ZONE_COLORS = { top: '#f5c542', bottom: '#ef4444' } as const;
  const zoneColor = new Map<number, string>();
  const elimZone = new Set<number>();
  if (playoffZones && firstColMode === 'player') {
    const n = rows.length;
    for (const r of rows) {
      const rank = canonicalRankOf.get(r.player_id);
      if (rank == null) continue;
      if (rank <= playoffZones.top) {
        zoneColor.set(r.player_id, ZONE_COLORS.top);
      } else if (rank > n - playoffZones.bottom) {
        zoneColor.set(r.player_id, ZONE_COLORS.bottom);
        elimZone.add(r.player_id);
      }
    }
  }

  // Medal positions (skipped when playoff zones are active)
  const medalRank = new Map<number, 1 | 2 | 3>();
  if (showMedals && !playoffZones && firstColMode === 'player') {
    for (const r of rows) {
      const rank = canonicalRankOf.get(r.player_id);
      if (rank === 1 || rank === 2 || rank === 3) medalRank.set(r.player_id, rank);
    }
  }

  const MEDAL_COLORS: Record<1 | 2 | 3, string> = {
    1: '#f5c542',
    2: '#a0a3ab',
    3: '#c47a3a',
  };

  const dash = (played: boolean, v: string) =>
    played ? v : <span className="text-[var(--color-text-secondary)]">—</span>;

  const firstColLabel = firstColMode === 'season' ? 'Season' : 'Player';

  const TROPHY_COLS: { key: SortCol; label: string; title: string; rank: 1 | 2 | 3 }[] = [
    { key: 'gold',   label: '🥇', title: 'Gold Medals',   rank: 1 },
    { key: 'silver', label: '🥈', title: 'Silver Medals', rank: 2 },
    { key: 'bronze', label: '🥉', title: 'Bronze Medals', rank: 3 },
  ];

  const hasEhog = ehogRatings && Object.keys(ehogRatings).length > 0;

  const STAT_COLS: { key: SortCol; label: string; title: string }[] = [
    { key: 'gp',  label: 'GP',   title: 'Games Played' },
    { key: 'wr',  label: 'WR%',  title: 'Win Rate' },
    { key: 'rwr', label: 'RWR%', title: 'Round Win Rate' },
    { key: 'adr', label: 'ADR',  title: 'Average Damage per Round' },
  ];

  function SortableTh({ col }: { col: { key: SortCol; label: string; title?: string } }) {
    const active = sortCol === col.key;
    return (
      <th
        title={col.title}
        tabIndex={0}
        aria-sort={active ? (asc ? 'ascending' : 'descending') : 'none'}
        onClick={() => clickHeader(col.key)}
        onKeyDown={(e) => headerKey(e, col.key)}
        className={`tracked text-[10px] font-semibold py-2.5 px-2 border-b border-[var(--color-border-primary)] cursor-pointer select-none whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)] text-right ${
          active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
        }`}
      >
        {col.label}
        {active && <span className="ml-1">{asc ? '↑' : '↓'}</span>}
      </th>
    );
  }

  return (
    <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-[var(--color-bg-secondary)]">
            {firstColMode === 'player' && showRank && (
              <th className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-left pl-4 pr-2 py-2.5 border-b border-[var(--color-border-primary)] w-6">
                #
              </th>
            )}
            <th
              tabIndex={0}
              aria-sort={sortCol === 'name' ? (asc ? 'ascending' : 'descending') : 'none'}
              onClick={() => clickHeader('name')}
              onKeyDown={(e) => headerKey(e, 'name')}
              className={`tracked text-[10px] font-semibold py-2.5 border-b border-[var(--color-border-primary)] cursor-pointer select-none whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)] text-left ${
                firstColMode === 'player' && showRank ? 'px-2' : 'pl-4 pr-2'
              } ${sortCol === 'name' ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
            >
              {firstColLabel}
              {sortCol === 'name' && <span className="ml-1">{asc ? '↑' : '↓'}</span>}
            </th>
            {trophyCounts && firstColMode === 'player' && TROPHY_COLS.map((c) => <SortableTh key={c.key} col={c} />)}
            {STAT_COLS.map((c) => <SortableTh key={c.key} col={c} />)}
            {hasEhog && <SortableTh col={{ key: 'ehog', label: 'EHOG', title: 'EHOG rating as of most recent match in this view' }} />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const played = p.total_rounds_played > 0;
            const medal = medalRank.get(p.player_id);
            const zone = zoneColor.get(p.player_id);
            const rowColor = zone ?? (medal ? MEDAL_COLORS[medal] : null);
            const textColor = elimZone.has(p.player_id)
              ? 'var(--color-text-secondary)'
              : rowColor;
            const href = firstColMode === 'season'
              ? `/seasons/${p.season_id}`
              : `/players/${p.player_id}`;
            return (
              <tr
                key={firstColMode === 'season' ? p.season_id : p.player_id}
                className="border-b border-[var(--color-border-tertiary)] last:border-b-0 cursor-pointer transition-colors"
                style={rowColor
                  ? { background: `color-mix(in srgb, ${rowColor} 8%, var(--color-bg-primary))` }
                  : undefined
                }
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = rowColor ? `color-mix(in srgb, ${rowColor} 14%, var(--color-bg-primary))` : 'var(--color-bg-secondary)'; onPlayerHover?.(p.player_id); }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = rowColor ? `color-mix(in srgb, ${rowColor} 8%, var(--color-bg-primary))` : ''; onPlayerHover?.(null); }}
              >
                {firstColMode === 'player' && showRank && (
                  <td className="pl-4 pr-2 py-2.5 font-mono text-[11px] tnum"
                    style={{ color: textColor ?? 'var(--color-text-secondary)' }}
                  >
                    <Link href={href} className="block w-full h-full">{canonicalRankOf.get(p.player_id) ?? '-'}</Link>
                  </td>
                )}
                <td className={`py-2.5 font-display font-semibold ${firstColMode === 'player' && showRank ? 'px-2' : 'pl-4 pr-2'}`}
                  style={{ color: textColor ?? undefined }}
                >
                  <Link href={href} className="flex items-center w-full h-full">
                    <PlayerName name={p.player_name} isMe={firstColMode === 'player' && myPlayerId !== null && p.player_id === myPlayerId} />
                  </Link>
                </td>
                {trophyCounts && firstColMode === 'player' && TROPHY_COLS.map((c) => (
                  <td key={c.key} className="py-2.5 px-2 text-right font-mono tnum">
                    <Link href={href} className="block w-full h-full">{trophyCounts.get(p.player_id)?.[c.rank] ?? 0}</Link>
                  </td>
                ))}
                <td className="py-2.5 px-2 text-right font-mono tnum text-[var(--color-text-secondary)]">
                  <Link href={href} className="block w-full h-full">{p.matches_played}</Link>
                </td>
                <td className="py-2.5 px-2 text-right font-mono tnum">
                  <Link href={href} className="block w-full h-full">{dash(played, `${p.win_rate_percentage.toFixed(1)}%`)}</Link>
                </td>
                <td className="py-2.5 px-2 text-right font-mono tnum">
                  <Link href={href} className="block w-full h-full">{dash(played, `${p.rwr_percentage.toFixed(1)}%`)}</Link>
                </td>
                <td className="py-2.5 pr-4 pl-2 text-right font-mono tnum font-semibold">
                  <Link href={href} className="block w-full h-full">{dash(played, p.overall_adr.toFixed(2))}</Link>
                </td>
                {hasEhog && (
                  <td
                    className="py-2.5 pr-4 pl-2 text-right font-mono tnum font-semibold"
                    title={ehogRatings[p.player_id] != null ? 'EHOG rating as of most recent match in this view' : undefined}
                    style={ehogRatings[p.player_id] != null ? { color: ehogColorFor(ehogRatings[p.player_id]) } : undefined}
                  >
                    <Link href={href} className="block w-full h-full">
                      {ehogRatings[p.player_id] != null
                        ? ehogRatings[p.player_id].toFixed(1)
                        : <span className="text-[var(--color-text-secondary)]">—</span>}
                    </Link>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
