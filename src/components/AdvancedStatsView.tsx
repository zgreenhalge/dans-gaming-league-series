'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { LeaderboardRowWithId } from '@/lib/types';
import { computeAdvancedStats, AdvancedStats } from '@/lib/stats';

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

function PlayerNameCell({ row }: { row: LeaderboardRowWithId }) {
  return (
    <Link href={`/players/${row.player_id}`} className="hover:underline">
      {row.player_name}
    </Link>
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
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)]">
                Player
              </th>
              <SortableTh label="Kills"            sortKey="k"     state={sort} onClick={toggleSort} />
              <SortableTh label="Assists"          sortKey="a"     state={sort} onClick={toggleSort} />
              <SortableTh label="Deaths"           sortKey="d"     state={sort} onClick={toggleSort} />
              <SortableTh label="Damage"           sortKey="dmg"   state={sort} onClick={toggleSort} />
              <SortableTh label="Kill Differential" sortKey="kdiff" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ row, stats }) => (
              <tr key={row.player_id} className="hover:bg-[var(--color-bg-hover)] border-b border-[var(--color-border-secondary)]">
                <td className="px-3 py-2">
                  <PlayerNameCell row={row} />
                </td>
                <td className="px-3 py-2 text-right tnum">{row.total_kills}</td>
                <td className="px-3 py-2 text-right tnum">{row.total_assists}</td>
                <td className="px-3 py-2 text-right tnum">{row.total_deaths}</td>
                <td className="px-3 py-2 text-right tnum">{row.total_damage.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tnum">{fmtDiff(stats.killDiff)}</td>
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
        <table className="w-full border-collapse text-xs">
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
              <tr key={row.player_id} className="hover:bg-[var(--color-bg-hover)] border-b border-[var(--color-border-secondary)]">
                <td className="px-3 py-2">
                  <PlayerNameCell row={row} />
                </td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(row.kd_ratio, 2)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(stats.dmgPerKill, 1)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(stats.kPerRound, 2)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(stats.aPerRound, 2)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(stats.dPerRound, 2)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(stats.kPerWin, 1)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(stats.dPerWin, 1)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(stats.kPerLoss, 1)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(stats.dPerLoss, 1)}</td>
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
        <table className="w-full border-collapse text-xs">
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
              <tr key={row.player_id} className="hover:bg-[var(--color-bg-hover)] border-b border-[var(--color-border-secondary)]">
                <td className="px-3 py-2">
                  <PlayerNameCell row={row} />
                </td>
                <td className="px-3 py-2 text-right tnum">{row.matches_played}</td>
                <td className="px-3 py-2 text-right tnum">
                  {row.matches_won}–{row.matches_lost}
                </td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(row.win_rate_percentage, 1)}</td>
                <td className="px-3 py-2 text-right tnum">{row.total_rounds_played}</td>
                <td className="px-3 py-2 text-right tnum">
                  {row.total_rounds_won}–{stats.roundsLost}
                </td>
                <td className="px-3 py-2 text-right tnum">{fmtDiff(stats.roundDiff)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(row.rwr_percentage, 1)}</td>
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
        <table className="w-full border-collapse text-xs">
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
              <tr key={row.player_id} className="hover:bg-[var(--color-bg-hover)] border-b border-[var(--color-border-secondary)]">
                <td className="px-3 py-2">
                  <PlayerNameCell row={row} />
                </td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(stats.rPerGame, 1)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtDiff(stats.rdPerGame, 2)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(stats.rwPerGame, 2)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(stats.rlPerGame, 2)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtDiff(stats.kdPerGame, 2)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(stats.dmgPerGame, 1)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(stats.kPerGame, 2)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(stats.aPerGame, 2)}</td>
                <td className="px-3 py-2 text-right tnum">{fmtNum(stats.dPerGame, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdvancedStatsView({ rows }: { rows: LeaderboardRowWithId[] }) {
  const data = useMemo(() => rows.map((row) => ({ row, stats: computeAdvancedStats(row) })), [rows]);

  return (
    <div className="space-y-6">
      <BasicStatsTable data={data} />
      <KillStatsTable data={data} />
      <GameStatsTable data={data} />
      <AverageGameStatsTable data={data} />
    </div>
  );
}
