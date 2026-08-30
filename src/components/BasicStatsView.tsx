'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { LeaderboardRowWithId, type RoundCondition } from '@/lib/types';
import { computeAdvancedStats, AdvancedStats } from '@/lib/stats';
import { aggregateMapPickBanStats, aggregatePerSideStats, aggregateScoreDistribution, aggregateWinConditions, type MapPickBanStat, type PerSideStat, type ScoreDistribution, type WinConditionBreakdown, type MatchPickBanInput, type RoundOutcome } from '@/lib/mapSideStats';
import { mapSlug } from '@/lib/maps';
import { tabCls } from '@/lib/util';
import { useTabState, resolveTab } from './useTabState';
import EmptyState from './EmptyState';
import Th from './Th';
import PerSideStatsTable from './PerSideStatsTable';
import { CONDITION_LABEL } from './icons/ConditionIcons';

type SortKey = string;

interface SortState {
  col: SortKey;
  asc: boolean;
}

function useSortState(defaultCol: SortKey): [SortState, (col: SortKey) => void] {
  const [sort, setSort] = useState<SortState>({ col: defaultCol, asc: false });
  const toggle = useCallback(
    (col: SortKey) => setSort((s) => s.col === col ? { col, asc: !s.asc } : { col, asc: false }),
    [],
  );
  return [sort, toggle];
}

interface RowWithStats {
  row: LeaderboardRowWithId;
  stats: AdvancedStats;
}

function SortableTh({ label, title, sortKey, state, onClick }: { label: string; title?: string; sortKey: SortKey; state: SortState; onClick: (key: SortKey) => void }) {
  const isActive = state.col === sortKey;
  const arrow = isActive ? (state.asc ? ' ↑' : ' ↓') : '';
  return (
    <th
      title={title}
      onClick={() => onClick(sortKey)}
      className="cursor-pointer select-none px-3 py-2 text-right text-xs font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)] hover:bg-[var(--color-bg-hover)]"
    >
      {label}
      {arrow}
    </th>
  );
}

function fmtNum(v: number, decimals: number = 0): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(decimals);
}

function fmtDiff(v: number, decimals: number = 0): string {
  if (!Number.isFinite(v)) return '—';
  const s = v.toFixed(decimals);
  return v > 0 ? `+${s}` : s;
}

function BasicStatsTable({ data }: { data: RowWithStats[] }) {
  const [sort, toggleSort] = useSortState('k');

  const sorted = useMemo(() => {
    const copy = [...data];
    copy.sort((a, b) => {
      let aVal, bVal;
      switch (sort.col) {
        case 'k':    aVal = a.row.total_kills;   bVal = b.row.total_kills;   break;
        case 'a':    aVal = a.row.total_assists;  bVal = b.row.total_assists; break;
        case 'd':    aVal = a.row.total_deaths;   bVal = b.row.total_deaths;  break;
        case 'dmg':  aVal = a.row.total_damage;   bVal = b.row.total_damage;  break;
        case 'adr':  aVal = a.row.overall_adr;    bVal = b.row.overall_adr;   break;
        case 'kdiff': aVal = a.stats.killDiff;    bVal = b.stats.killDiff;    break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [data, sort]);

  return (
    <div className="my-6">
      <h3 className="text-sm font-semibold mb-3">Basic Stats</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className="bg-[var(--color-bg-secondary)]">
              <th className="sticky-col px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)]">
                Player
              </th>
              <SortableTh label="Kills"            sortKey="k"     state={sort} onClick={toggleSort} />
              <SortableTh label="Assists"          sortKey="a"     state={sort} onClick={toggleSort} />
              <SortableTh label="Deaths"           sortKey="d"     state={sort} onClick={toggleSort} />
              <SortableTh label="Kill Differential" sortKey="kdiff" state={sort} onClick={toggleSort} />
              <SortableTh label="Damage"           sortKey="dmg"   state={sort} onClick={toggleSort} />
              <SortableTh label="ADR" title="Average Damage per Round" sortKey="adr" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ row, stats }) => (
              <tr key={row.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                <td className="sticky-col px-3 py-2">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {row.player_name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {row.total_kills}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {row.total_assists}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {row.total_deaths}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtDiff(stats.killDiff)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {row.total_damage.toLocaleString()}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(row.overall_adr, 2)}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KillStatsTable({ data }: { data: RowWithStats[] }) {
  const [sort, toggleSort] = useSortState('kd');

  const sorted = useMemo(() => {
    const copy = [...data];
    copy.sort((a, b) => {
      let aVal, bVal;
      switch (sort.col) {
        case 'kd':  aVal = a.row.kd_ratio;     bVal = b.row.kd_ratio;     break;
        case 'dpk': aVal = a.stats.dmgPerKill;  bVal = b.stats.dmgPerKill; break;
        case 'kr':  aVal = a.stats.kPerRound;   bVal = b.stats.kPerRound;  break;
        case 'ar':  aVal = a.stats.aPerRound;   bVal = b.stats.aPerRound;  break;
        case 'dr':  aVal = a.stats.dPerRound;   bVal = b.stats.dPerRound;  break;
        case 'kw':  aVal = a.stats.kPerWin;     bVal = b.stats.kPerWin;    break;
        case 'dw':  aVal = a.stats.dPerWin;     bVal = b.stats.dPerWin;    break;
        case 'kl':  aVal = a.stats.kPerLoss;    bVal = b.stats.kPerLoss;   break;
        case 'dl':  aVal = a.stats.dPerLoss;    bVal = b.stats.dPerLoss;   break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [data, sort]);

  return (
    <div className="my-6">
      <h3 className="text-sm font-semibold mb-3">Kill Stats</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className="bg-[var(--color-bg-secondary)]">
              <th className="sticky-col px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)]">
                Player
              </th>
              <SortableTh label="K/D"      title="Kill/Death Ratio"      sortKey="kd"  state={sort} onClick={toggleSort} />
              <SortableTh label="Dmg/K"    title="Damage per Kill"        sortKey="dpk" state={sort} onClick={toggleSort} />
              <SortableTh label="K/Round"  title="Kills per Round"        sortKey="kr"  state={sort} onClick={toggleSort} />
              <SortableTh label="A/Round"  title="Assists per Round"      sortKey="ar"  state={sort} onClick={toggleSort} />
              <SortableTh label="D/Round"  title="Deaths per Round"       sortKey="dr"  state={sort} onClick={toggleSort} />
              <SortableTh label="K/Win"    title="Kills per Win"          sortKey="kw"  state={sort} onClick={toggleSort} />
              <SortableTh label="D/Win"    title="Deaths per Win"         sortKey="dw"  state={sort} onClick={toggleSort} />
              <SortableTh label="K/Loss"   title="Kills per Loss"         sortKey="kl"  state={sort} onClick={toggleSort} />
              <SortableTh label="D/Loss"   title="Deaths per Loss"        sortKey="dl"  state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ row, stats }) => (
              <tr key={row.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                <td className="sticky-col px-3 py-2">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {row.player_name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(row.kd_ratio, 2)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(stats.dmgPerKill, 1)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(stats.kPerRound, 2)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(stats.aPerRound, 2)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(stats.dPerRound, 2)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(stats.kPerWin, 1)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(stats.dPerWin, 1)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(stats.kPerLoss, 1)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(stats.dPerLoss, 1)}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GameStatsTable({ data }: { data: RowWithStats[] }) {
  const [sort, toggleSort] = useSortState('wl');

  const sorted = useMemo(() => {
    const copy = [...data];
    copy.sort((a, b) => {
      let aVal, bVal;
      switch (sort.col) {
        case 'games':
          aVal = a.row.matches_played;
          bVal = b.row.matches_played;
          break;
        case 'wl':
          // wins desc primary, losses asc secondary — encode as wins*1000 - losses
          aVal = a.row.matches_won * 1000 - a.row.matches_lost;
          bVal = b.row.matches_won * 1000 - b.row.matches_lost;
          break;
        case 'wr':
          aVal = a.row.win_rate_percentage;
          bVal = b.row.win_rate_percentage;
          break;
        case 'rounds':
          aVal = a.row.total_rounds_played;
          bVal = b.row.total_rounds_played;
          break;
        case 'rw':
          aVal = a.row.total_rounds_won;
          bVal = b.row.total_rounds_won;
          break;
        case 'rdiff':
          aVal = a.stats.roundDiff;
          bVal = b.stats.roundDiff;
          break;
        case 'rwr':
          aVal = a.row.rwr_percentage;
          bVal = b.row.rwr_percentage;
          break;
        default:
          return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [data, sort]);

  return (
    <div className="my-6">
      <h3 className="text-sm font-semibold mb-3">Game Stats</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className="bg-[var(--color-bg-secondary)]">
              <th className="sticky-col px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)]">
                Player
              </th>
              <SortableTh label="Games"    title="Games Played"          sortKey="games" state={sort} onClick={toggleSort} />
              <SortableTh label="W–L"      title="Wins – Losses"         sortKey="wl"    state={sort} onClick={toggleSort} />
              <SortableTh label="WR%"      title="Win Rate"              sortKey="wr"    state={sort} onClick={toggleSort} />
              <SortableTh label="Rounds"   title="Total Rounds Played"   sortKey="rounds" state={sort} onClick={toggleSort} />
              <SortableTh label="RW–RL"    title="Rounds Won – Rounds Lost" sortKey="rw" state={sort} onClick={toggleSort} />
              <SortableTh label="Rnd Diff" title="Round Differential"    sortKey="rdiff" state={sort} onClick={toggleSort} />
              <SortableTh label="RWR%"     title="Round Win Rate"        sortKey="rwr"   state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ row, stats }) => (
              <tr key={row.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                <td className="sticky-col px-3 py-2">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {row.player_name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {row.matches_played}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {row.matches_won}–{row.matches_lost}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(row.win_rate_percentage, 1)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {row.total_rounds_played}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {row.total_rounds_won}–{stats.roundsLost}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtDiff(stats.roundDiff)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(row.rwr_percentage, 1)}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AverageGameStatsTable({ data }: { data: RowWithStats[] }) {
  const [sort, toggleSort] = useSortState('rg');

  const sorted = useMemo(() => {
    const copy = [...data];
    copy.sort((a, b) => {
      let aVal, bVal;
      switch (sort.col) {
        case 'rg':   aVal = a.stats.rPerGame;   bVal = b.stats.rPerGame;   break;
        case 'rdg':  aVal = a.stats.rdPerGame;  bVal = b.stats.rdPerGame;  break;
        case 'rwg':  aVal = a.stats.rwPerGame;  bVal = b.stats.rwPerGame;  break;
        case 'rlg':  aVal = a.stats.rlPerGame;  bVal = b.stats.rlPerGame;  break;
        case 'kdg':  aVal = a.stats.kdPerGame;  bVal = b.stats.kdPerGame;  break;
        case 'dmgg': aVal = a.stats.dmgPerGame; bVal = b.stats.dmgPerGame; break;
        case 'kg':   aVal = a.stats.kPerGame;   bVal = b.stats.kPerGame;   break;
        case 'ag':   aVal = a.stats.aPerGame;   bVal = b.stats.aPerGame;   break;
        case 'dg':   aVal = a.stats.dPerGame;   bVal = b.stats.dPerGame;   break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [data, sort]);

  return (
    <div className="my-6">
      <h3 className="text-sm font-semibold mb-3">Average Game Stats</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className="bg-[var(--color-bg-secondary)]">
              <th className="sticky-col px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)]">
                Player
              </th>
              <SortableTh label="Rounds/Game"     title="Rounds Played per Game"      sortKey="rg"   state={sort} onClick={toggleSort} />
              <SortableTh label="Round Diff/Game" title="Round Differential per Game"  sortKey="rdg"  state={sort} onClick={toggleSort} />
              <SortableTh label="Rounds Won/Game" title="Rounds Won per Game"          sortKey="rwg"  state={sort} onClick={toggleSort} />
              <SortableTh label="Rounds Lost/Game" title="Rounds Lost per Game"        sortKey="rlg"  state={sort} onClick={toggleSort} />
              <SortableTh label="K Diff/Game"     title="Kill Differential per Game"   sortKey="kdg"  state={sort} onClick={toggleSort} />
              <SortableTh label="Dmg/Game"        title="Damage per Game"              sortKey="dmgg" state={sort} onClick={toggleSort} />
              <SortableTh label="K/Game"          title="Kills per Game"               sortKey="kg"   state={sort} onClick={toggleSort} />
              <SortableTh label="A/Game"          title="Assists per Game"             sortKey="ag"   state={sort} onClick={toggleSort} />
              <SortableTh label="D/Game"          title="Deaths per Game"              sortKey="dg"   state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ row, stats }) => (
              <tr key={row.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                <td className="sticky-col px-3 py-2">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {row.player_name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(stats.rPerGame, 1)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtDiff(stats.rdPerGame, 2)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(stats.rwPerGame, 2)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(stats.rlPerGame, 2)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtDiff(stats.kdPerGame, 2)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(stats.dmgPerGame, 1)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(stats.kPerGame, 2)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(stats.aPerGame, 2)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tnum">
                  <Link href={`/players/${row.player_id}`} className="block">
                    {fmtNum(stats.dPerGame, 2)}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface DistributionBucket {
  label: string;
  count: number;
  note?: string;
}

/** The shared Category/Count/% shape behind `ScoreDistributionTable` and `WinConditionTable` —
 *  same bordered table, empty state, and percentage-of-total column, parameterized by title,
 *  category column header, and bucket list so the two callers differ only in their data. */
function DistributionTable({ title, emptyMessage, categoryLabel, total, buckets }: {
  title: string;
  emptyMessage: string;
  categoryLabel: string;
  total: number;
  buckets: DistributionBucket[];
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <span className="tracked text-[10px] text-[var(--color-text-secondary)]">{title}</span>
      </div>
      {total === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead>
              <tr className="bg-[var(--color-bg-secondary)]">
                <Th align="left">{categoryLabel}</Th>
                <Th align="right">Count</Th>
                <Th align="right">%</Th>
              </tr>
            </thead>
            <tbody>
              {buckets.map(({ label, count, note }) => (
                <tr key={label} className="lift-row border-b border-[var(--color-border-tertiary)] last:border-b-0">
                  <td className="pl-4 pr-3 py-2.5">
                    <span className="tracked text-[11px] font-semibold">{label}</span>
                    {note && <span className="ml-2 text-[10px] text-[var(--color-text-secondary)]">{note}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{count}</td>
                  <td className="px-3 pr-4 py-2.5 text-right font-mono tnum text-[var(--color-text-secondary)]">
                    {((count / total) * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ScoreDistributionTable({ dist }: { dist: ScoreDistribution }) {
  return (
    <DistributionTable
      title="Score distribution"
      emptyMessage="No match data."
      categoryLabel="Category"
      total={dist.total}
      buckets={[
        { label: 'Crushing', count: dist.crushed, note: '13–3 or worse' },
        { label: 'Convincing', count: dist.convincing, note: '13–4 to 13–6' },
        { label: 'Competitive', count: dist.competitive, note: '13–7 to 13–9' },
        { label: 'Close', count: dist.close, note: '13–10 or 13–11' },
        { label: 'CRAZY', count: dist.crazy, note: 'Overtime' },
      ]}
    />
  );
}

const CONDITION_BUCKETS = Object.keys(CONDITION_LABEL) as RoundCondition[];

/** How rounds in scope were decided, fed by `aggregateWinConditions()` instead of
 *  `aggregateScoreDistribution()` — same `DistributionTable` shape as `ScoreDistributionTable`.
 *  "Ninja" is appended after the four `RoundCondition` buckets rather than folded into `CONDITION_
 *  BUCKETS` — it's a defuse-win subset (see `WinConditionBreakdown.ninja`), not its own `win_reason`,
 *  so its % column reads as "share of all rounds", not "share of defuses". */
function WinConditionTable({ dist }: { dist: WinConditionBreakdown }) {
  return (
    <DistributionTable
      title="Round win condition"
      emptyMessage="No round data."
      categoryLabel="Condition"
      total={dist.total}
      buckets={[
        ...CONDITION_BUCKETS.map((key) => ({ label: CONDITION_LABEL[key], count: dist[key] })),
        { label: 'Ninja', count: dist.ninja, note: 'defuse, T(s) still alive' },
      ]}
    />
  );
}

function MapsAndSidesSection({
  singleMap,
  scoreDistribution,
  winConditions,
  mapPickBanStats,
  perSideStats,
}: {
  singleMap: boolean;
  scoreDistribution: ScoreDistribution | null;
  winConditions: WinConditionBreakdown | null;
  mapPickBanStats: MapPickBanStat[];
  perSideStats: PerSideStat[];
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Score Distribution sits in this top 2-col row on a single map page (paired with
          per-side stats); on a multi-map page it moves to its own row below instead, paired
          with Win Condition there, alongside the pick/ban table here, so four panels don't
          fight for two columns. */}
      {singleMap && scoreDistribution && <ScoreDistributionTable dist={scoreDistribution} />}
      {!singleMap && <div>
        <div className="flex items-baseline justify-between mb-3">
          <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Map pick/ban stats</span>
        </div>
        {mapPickBanStats.length === 0 ? (
          <EmptyState message="No map data." />
        ) : (
          <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-[12px]">
              <thead>
                <tr className="bg-[var(--color-bg-secondary)]">
                  <Th align="left">Map</Th>
                  <Th align="right">Picks</Th>
                  <Th align="right">Bans</Th>
                  <Th align="right">No-picks</Th>
                  <Th align="right">CT</Th>
                  <Th align="right">T</Th>
                  <Th align="right">Pick &amp; won</Th>
                  <Th align="right">Avg rounds</Th>
                </tr>
              </thead>
              <tbody>
                {mapPickBanStats.map((m) => (
                  <tr key={m.map} className="lift-row border-b border-[var(--color-border-tertiary)] last:border-b-0">
                    <td className="pl-4 pr-3 py-2.5 tracked text-[11px] font-semibold">
                      <Link href={`/maps/${mapSlug(m.map)}`} className="hover:text-[var(--color-accent)] transition-colors">{m.map}</Link>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{m.picked}</td>
                    <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-secondary)]">{m.banned}</td>
                    <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-secondary)]">{m.noPicked}</td>
                    <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-secondary)]">{m.ctPicked}</td>
                    <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-secondary)]">{m.tPicked}</td>
                    <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{m.pickedAndWon}</td>
                    <td className="px-3 pr-4 py-2.5 text-right font-mono tnum text-[var(--color-text-secondary)]">{m.picked > 0 ? m.avgRounds.toFixed(1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>}

      {/* Per-Side Stats */}
      <PerSideStatsTable perSideStats={perSideStats} />
      </div>
      {!singleMap ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {scoreDistribution && <ScoreDistributionTable dist={scoreDistribution} />}
          {winConditions && <WinConditionTable dist={winConditions} />}
        </div>
      ) : (
        winConditions && <WinConditionTable dist={winConditions} />
      )}
    </div>
  );
}

type BasicStatsTab = 'basic' | 'kills' | 'games' | 'averages' | 'sides';

// Every possible sub-tab, for `useTabState`'s own missing/invalid-param fallback — the
// `resolveTab(...)` call below still hides "Maps & Sides" when there's no per-match data to show there.
const BASIC_STATS_TABS: readonly BasicStatsTab[] = ['basic', 'kills', 'games', 'averages', 'sides'];

/**
 * The site's baseline K/D/A/ADR-family stats — named to stay distinct from the demo-derived
 * "Advanced Stats" tab (SabremetricsLeaderboardView), which this predates and is unrelated to.
 *
 * Rendered from three different "Stats" tabs (season hub, map detail, career stats page), each of
 * which already owns its own outer `tab` param — this sub-tab reads/writes a `stab` param (distinct
 * from `tab`) directly, with no controlled/uncontrolled duality needed: exactly one `BasicStatsView`
 * is ever mounted at a time, unlike `SeasonTabView`'s two parallel regular/gauntlet instances.
 */
export function BasicStatsView({ rows, matches, rounds, singleMap = false }: { rows: LeaderboardRowWithId[]; matches?: MatchPickBanInput[]; rounds?: RoundOutcome[]; singleMap?: boolean }) {
  const data = useMemo(() => rows.map((row) => ({ row, stats: computeAdvancedStats(row) })), [rows]);
  const [rawTab, setTab] = useTabState(BASIC_STATS_TABS, 'basic', 'stab');

  const mapPickBanStats = useMemo<MapPickBanStat[]>(
    () => (matches && !singleMap ? aggregateMapPickBanStats(matches) : []),
    [matches, singleMap],
  );

  const perSideStats = useMemo<PerSideStat[]>(
    () => (matches ? aggregatePerSideStats(matches, rounds ?? []) : []),
    [matches, rounds],
  );

  const scoreDistribution = useMemo<ScoreDistribution | null>(
    () => (matches ? aggregateScoreDistribution(matches) : null),
    [matches],
  );

  const winConditions = useMemo<WinConditionBreakdown | null>(
    () => (matches ? aggregateWinConditions(rounds ?? []) : null),
    [matches, rounds],
  );

  const tabs: { key: BasicStatsTab; label: string }[] = [
    { key: 'basic', label: 'Basic Stats' },
    { key: 'kills', label: 'Kill Stats' },
    { key: 'games', label: 'Game Stats' },
    { key: 'averages', label: 'Averages' },
    ...(matches ? [{ key: 'sides' as const, label: 'Maps & Sides' }] : []),
  ];
  // Falls back to the first surviving tab when `stab` names one this call site has hidden (e.g.
  // `stab=sides` on a view with no per-match data).
  const tab = resolveTab(rawTab, tabs);

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" className={tabCls(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'basic' && <BasicStatsTable data={data} />}
      {tab === 'kills' && <KillStatsTable data={data} />}
      {tab === 'games' && <GameStatsTable data={data} />}
      {tab === 'averages' && <AverageGameStatsTable data={data} />}
      {tab === 'sides' && matches && (
        <MapsAndSidesSection
          singleMap={singleMap}
          scoreDistribution={scoreDistribution}
          winConditions={winConditions}
          mapPickBanStats={mapPickBanStats}
          perSideStats={perSideStats}
        />
      )}
    </div>
  );
}
