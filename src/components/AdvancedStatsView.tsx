'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { LeaderboardRowWithId } from '@/lib/types';
import { computeAdvancedStats, AdvancedStats } from '@/lib/stats';
import { aggregateMapPickBanStats, aggregatePerSideStats, aggregateScoreDistribution, type MapPickBanStat, type PerSideStat, type ScoreDistribution, type MatchPickBanInput } from '@/lib/mapSideStats';
import { mapSlug } from '@/lib/maps';

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
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)]">
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
              <tr key={row.player_id} className="lift-row border-b border-[var(--color-border-secondary)]">
                <td className="px-3 py-2">
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
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)]">
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
              <tr key={row.player_id} className="lift-row border-b border-[var(--color-border-secondary)]">
                <td className="px-3 py-2">
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
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)]">
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
              <tr key={row.player_id} className="lift-row border-b border-[var(--color-border-secondary)]">
                <td className="px-3 py-2">
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
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)]">
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
              <tr key={row.player_id} className="lift-row border-b border-[var(--color-border-secondary)]">
                <td className="px-3 py-2">
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

function ScoreDistributionTable({ dist }: { dist: ScoreDistribution }) {
  const buckets = [
    { label: 'Landslide',   count: dist.landslide,    note: '13–8 or worse' },
    { label: 'Comfortable', count: dist.comfortable,  note: '13–9 or 13–10' },
    { label: 'Close',       count: dist.close,        note: '13–11 or 13–12' },
    { label: 'OT',          count: dist.ot,           note: 'Overtime' },
  ];
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Score distribution</span>
      </div>
      {dist.total === 0 ? (
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">No match data.</div>
      ) : (
        <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] overflow-hidden">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-[var(--color-bg-secondary)]">
                <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-left text-[var(--color-text-secondary)]">Category</th>
                <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">Count</th>
                <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">%</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map(({ label, count, note }) => (
                <tr key={label} className="lift-row border-b border-[var(--color-border-tertiary)] last:border-b-0">
                  <td className="pl-4 pr-3 py-2.5">
                    <span className="tracked text-[11px] font-semibold">{label}</span>
                    <span className="ml-2 text-[10px] text-[var(--color-text-secondary)]">{note}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{count}</td>
                  <td className="px-3 pr-4 py-2.5 text-right font-mono tnum text-[var(--color-text-secondary)]">
                    {((count / dist.total) * 100).toFixed(0)}%
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

export function AdvancedStatsView({ rows, matches, singleMap = false }: { rows: LeaderboardRowWithId[]; matches?: MatchPickBanInput[]; singleMap?: boolean }) {
  const data = useMemo(() => rows.map((row) => ({ row, stats: computeAdvancedStats(row) })), [rows]);

  const mapPickBanStats = useMemo<MapPickBanStat[]>(
    () => (matches && !singleMap ? aggregateMapPickBanStats(matches) : []),
    [matches, singleMap],
  );

  const perSideStats = useMemo<PerSideStat[]>(
    () => (matches ? aggregatePerSideStats(matches) : []),
    [matches],
  );

  const scoreDistribution = useMemo<ScoreDistribution | null>(
    () => (matches && singleMap ? aggregateScoreDistribution(matches) : null),
    [matches, singleMap],
  );

  return (
    <div className="space-y-6">
      {matches && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Score Distribution (singleMap) or Map Pick/Ban Stats (multi-map) */}
          {singleMap && scoreDistribution && <ScoreDistributionTable dist={scoreDistribution} />}
          {!singleMap && <div>
            <div className="flex items-baseline justify-between mb-3">
              <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Map pick/ban stats</span>
            </div>
            {mapPickBanStats.length === 0 ? (
              <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
                No map data.
              </div>
            ) : (
              <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] overflow-hidden">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="bg-[var(--color-bg-secondary)]">
                      <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-left text-[var(--color-text-secondary)]">Map</th>
                      <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">Picked</th>
                      <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">CT</th>
                      <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">T</th>
                      <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">W</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapPickBanStats.map((m) => (
                      <tr key={m.map} className="lift-row border-b border-[var(--color-border-tertiary)] last:border-b-0">
                        <td className="pl-4 pr-3 py-2.5 tracked text-[11px] font-semibold">
                          <Link href={`/maps/${mapSlug(m.map)}`} className="hover:text-[var(--color-accent)] transition-colors">{m.map}</Link>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{m.picked}</td>
                        <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-secondary)]">{m.ctPicked}</td>
                        <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-secondary)]">{m.tPicked}</td>
                        <td className="px-3 pr-4 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{m.pickedAndWon}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>}

          {/* Per-Side Stats */}
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Per-side stats</span>
            </div>
            {perSideStats.length === 0 ? (
              <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
                No side data.
              </div>
            ) : (
              <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] overflow-hidden">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="bg-[var(--color-bg-secondary)]">
                      <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-left text-[var(--color-text-secondary)]">Side</th>
                      <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">Times Picked</th>
                      <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">W-L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perSideStats.map((s) => (
                      <tr key={s.side} className="lift-row border-b border-[var(--color-border-tertiary)] last:border-b-0">
                        <td className="pl-4 pr-3 py-2.5 tracked text-[11px] font-semibold">{s.side}</td>
                        <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{s.numTimesPicked}</td>
                        <td className="px-3 pr-4 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{s.wins}-{s.losses}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      <BasicStatsTable data={data} />
      <KillStatsTable data={data} />
      <GameStatsTable data={data} />
      <AverageGameStatsTable data={data} />
    </div>
  );
}
