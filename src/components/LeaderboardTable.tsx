'use client';

import Link from 'next/link';
import { PlayerLink } from './PlayerLink';
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import type { LeaderboardRowWithId } from '@/lib/types';
import { PlayerName } from './PlayerName';
import { canonicalSort, playerHref } from '@/lib/util';
import { ehogColorFor } from './EhogBadge';
import Th from './Th';
import SortableTh from './SortableTh';
import { StatTable, Tr, Td, NameTd } from './StatTable';
import type { SeedPlacement } from '@/lib/gauntlet-bracket';

type SortCol =
  | 'name'
  | 'gold'
  | 'silver'
  | 'bronze'
  | 'rank'
  | 'gp'
  | 'record'
  | 'wr'
  | 'roundsRecord'
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
    case 'record':
      return (
        b.matches_won - a.matches_won ||
        b.rwr_percentage - a.rwr_percentage ||
        b.overall_adr - a.overall_adr
      );
    case 'rwr':
      return b.rwr_percentage - a.rwr_percentage;
    case 'roundsRecord':
      return (
        b.total_rounds_won - a.total_rounds_won ||
        (a.total_rounds_played - a.total_rounds_won) - (b.total_rounds_played - b.total_rounds_won)
      );
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
  stickyNameCol = true,
  gauntletSeeding,
  trophyCounts,
  canonicalRanking,
  ehogRatings,
  onPlayerHover,
}: {
  rows: LeaderboardRowWithId[];
  firstColMode?: 'player' | 'season';
  showMedals?: boolean;
  showRank?: boolean;
  /** Pin the name/season column while the rest scrolls. Off for narrow tables
   *  (e.g. player-page Season history) that fit without horizontal scroll. */
  stickyNameCol?: boolean;
  /** Live "if the season ended today" gauntlet seed projection — see `projectGauntletSeeding()`
   *  in `src/lib/gauntlet-bracket.ts`. Gold row tint for a bye, red for a seed that wouldn't
   *  qualify for the bracket at all. Drives row tinting only — always current, no separate column. */
  gauntletSeeding?: Map<number, SeedPlacement>;
  trophyCounts?: Map<number, Record<1 | 2 | 3, number>>;
  canonicalRanking?: Map<number, number>;
  ehogRatings?: Record<number, number>;
  onPlayerHover?: (playerId: number | null) => void;
}) {
  const { data: session } = useSession();
  const myPlayerId = session?.user?.playerId ?? null;

  const defaultSort: SortCol = trophyCounts ? 'gold' : canonicalRanking ? 'rank' : 'record';
  const [sortCol, setSortCol] = useState<SortCol>(defaultSort);
  const [asc, setAsc] = useState(false);
  const sortState = { col: sortCol, asc };

  function clickHeader(col: SortCol) {
    if (col === sortCol) setAsc(!asc);
    else {
      setSortCol(col);
      setAsc(col === 'name');
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const v = compare(a, b, sortCol, trophyCounts, canonicalRanking, ehogRatings);
    return asc ? -v : v;
  });

  // Canonical rank for the # column: use the provided gauntlet ranking when available,
  // otherwise fall back to Wins → RWR% → ADR.
  const canonicalRankOf: Map<number, number> = canonicalRanking
    ? canonicalRanking
    : new Map([...rows].sort(canonicalSort).map((r, i) => [r.player_id, i + 1]));

  // Gauntlet seeding projection coloring: gold for a bye, red for a seed that wouldn't qualify for
  // the bracket at all (overrides medals when provided).
  const ZONE_COLORS = { top: '#f5c542', bottom: '#ef4444' } as const;
  const zoneColor = new Map<number, string>();
  const elimZone = new Set<number>();
  if (gauntletSeeding && firstColMode === 'player') {
    for (const [playerId, placement] of gauntletSeeding) {
      if (!placement.qualifies) {
        zoneColor.set(playerId, ZONE_COLORS.bottom);
        elimZone.add(playerId);
      } else if (placement.isBye) {
        zoneColor.set(playerId, ZONE_COLORS.top);
      }
    }
  }

  // Medal positions (skipped when the gauntlet seeding projection is active)
  const medalRank = new Map<number, 1 | 2 | 3>();
  if (showMedals && !gauntletSeeding && firstColMode === 'player') {
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
    { key: 'gp',           label: 'GP',   title: 'Games Played' },
    { key: 'record',       label: 'W-L',  title: 'Match Record (Wins–Losses)' },
    { key: 'wr',           label: 'WR%',  title: 'Win Rate' },
    { key: 'roundsRecord', label: 'RW-L', title: 'Round Record (Wins–Losses)' },
    { key: 'rwr',          label: 'RWR%', title: 'Round Win Rate' },
    { key: 'adr',          label: 'ADR',  title: 'Average Damage per Round' },
  ];

  return (
    <StatTable>
      <thead>
        <tr>
          {firstColMode === 'player' && showRank && <Th className="w-6">#</Th>}
          <SortableTh label={firstColLabel} sortKey="name" state={sortState} onSort={clickHeader} sticky={stickyNameCol} />
          {trophyCounts && firstColMode === 'player' && TROPHY_COLS.map((c) => <SortableTh key={c.key} label={c.label} title={c.title} sortKey={c.key} state={sortState} onSort={clickHeader} align="right" />)}
          {hasEhog && <SortableTh label="EHOG" title="EHOG rating as of most recent match in this view" sortKey="ehog" state={sortState} onSort={clickHeader} align="right" />}
          {STAT_COLS.map((c) => <SortableTh key={c.key} label={c.label} title={c.title} sortKey={c.key} state={sortState} onSort={clickHeader} align="right" />)}
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => {
          const played = p.total_rounds_played > 0;
          const ehog = ehogRatings?.[p.player_id];
          const medal = medalRank.get(p.player_id);
          const zone = zoneColor.get(p.player_id);
          const rowColor = zone ?? (medal ? MEDAL_COLORS[medal] : null);
          const textColor = elimZone.has(p.player_id)
            ? 'var(--color-text-secondary)'
            : rowColor;
          const href = firstColMode === 'season'
            ? `/seasons/${p.season_id}`
            : playerHref(p.player_id);
          return (
            <Tr
              key={firstColMode === 'season' ? p.season_id : p.player_id}
              href={href}
              accent={rowColor ?? undefined}
              onMouseEnter={() => onPlayerHover?.(p.player_id)}
              onMouseLeave={() => onPlayerHover?.(null)}
            >
              {firstColMode === 'player' && showRank && (
                <Td align="left" style={{ color: textColor ?? 'var(--color-text-secondary)' }}>
                  {canonicalRankOf.get(p.player_id) ?? '-'}
                </Td>
              )}
              <NameTd sticky={stickyNameCol} style={{ color: textColor ?? undefined }}>
                {firstColMode === 'player' ? (
                  <PlayerLink playerId={p.player_id} className="flex items-center w-full h-full">
                    <PlayerName name={p.player_name} isMe={myPlayerId !== null && p.player_id === myPlayerId} />
                  </PlayerLink>
                ) : (
                  <Link href={href} className="flex items-center w-full h-full">
                    <PlayerName name={p.player_name} isMe={false} />
                  </Link>
                )}
              </NameTd>
              {trophyCounts && firstColMode === 'player' && TROPHY_COLS.map((c) => (
                <Td key={c.key}>{trophyCounts.get(p.player_id)?.[c.rank] ?? 0}</Td>
              ))}
              {hasEhog && (
                <Td
                  bold
                  title={ehog != null ? 'EHOG rating as of most recent match in this view' : undefined}
                  style={ehog != null ? { color: ehogColorFor(ehog) } : undefined}
                >
                  {ehog != null ? ehog.toFixed(1) : <span className="text-[var(--color-text-secondary)]">—</span>}
                </Td>
              )}
              <Td muted>{p.matches_played}</Td>
              <Td muted>{dash(played, `${p.matches_won}-${p.matches_lost}`)}</Td>
              <Td>{dash(played, `${p.win_rate_percentage.toFixed(1)}%`)}</Td>
              <Td muted>{dash(played, `${p.total_rounds_won}-${p.total_rounds_played - p.total_rounds_won}`)}</Td>
              <Td>{dash(played, `${p.rwr_percentage.toFixed(1)}%`)}</Td>
              <Td bold>{dash(played, p.overall_adr.toFixed(2))}</Td>
            </Tr>
          );
        })}
      </tbody>
    </StatTable>
  );
}
