'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import type { SabremetricMatchRow } from '@/lib/queries';

interface AggregatedSab {
  player_id: number;
  player_name: string;
  matches: number;
  rounds_played: number;
  kills: number;
  deaths: number;
  assists: number;
  headshot_kills: number;
  opening_kills: number;
  opening_deaths: number;
  kast_rounds: number;
  clutch_1v1_wins: number;
  clutch_1v1_attempts: number;
  clutch_1v2_wins: number;
  clutch_1v2_attempts: number;
  flash_assists: number;
  utility_damage: number;
  enemies_flashed: number;
  plants: number;
  defuses: number;
  two_k_rounds: number;
}

function aggregateRows(rows: SabremetricMatchRow[]): AggregatedSab[] {
  const byPlayer = new Map<number, AggregatedSab>();
  const matchesSeen = new Map<number, Set<number>>();

  for (const r of rows) {
    let agg = byPlayer.get(r.player_id);
    if (!agg) {
      agg = {
        player_id: r.player_id,
        player_name: r.player_name,
        matches: 0,
        rounds_played: 0,
        kills: 0, deaths: 0, assists: 0,
        headshot_kills: 0,
        opening_kills: 0, opening_deaths: 0,
        kast_rounds: 0,
        clutch_1v1_wins: 0, clutch_1v1_attempts: 0,
        clutch_1v2_wins: 0, clutch_1v2_attempts: 0,
        flash_assists: 0, utility_damage: 0, enemies_flashed: 0,
        plants: 0, defuses: 0, two_k_rounds: 0,
      };
      byPlayer.set(r.player_id, agg);
      matchesSeen.set(r.player_id, new Set());
    }

    const seen = matchesSeen.get(r.player_id)!;
    if (!seen.has(r.match_id)) {
      seen.add(r.match_id);
      agg.matches++;
    }

    agg.rounds_played += r.rounds_played;
    const s = r.sab;
    agg.kills += s.kills_ct + s.kills_t;
    agg.deaths += s.deaths_ct + s.deaths_t;
    agg.assists += s.assists_ct + s.assists_t;
    agg.headshot_kills += s.headshot_kills;
    agg.opening_kills += s.opening_kills;
    agg.opening_deaths += s.opening_deaths;
    agg.kast_rounds += s.kast_rounds;
    agg.clutch_1v1_wins += s.clutch_1v1_wins;
    agg.clutch_1v1_attempts += s.clutch_1v1_attempts;
    agg.clutch_1v2_wins += s.clutch_1v2_wins;
    agg.clutch_1v2_attempts += s.clutch_1v2_attempts;
    agg.flash_assists += s.flash_assists;
    agg.utility_damage += s.utility_damage;
    agg.enemies_flashed += s.enemies_flashed;
    agg.plants += s.plants;
    agg.defuses += s.defuses;
    agg.two_k_rounds += s.two_k_rounds;
  }

  return Array.from(byPlayer.values());
}

// --- Plus stats (1-scaled: 1.00 = league average) ---

function leagueAvgPerRound(all: AggregatedSab[], key: (a: AggregatedSab) => number): number {
  const totalVal = all.reduce((s, a) => s + key(a), 0);
  const totalRounds = all.reduce((s, a) => s + a.rounds_played, 0);
  return totalRounds > 0 ? totalVal / totalRounds : 0;
}

function plusStat(playerVal: number, avgVal: number): number {
  return avgVal > 0 ? playerVal / avgVal : 1;
}

interface PlusStat {
  kpr: number;
  apr: number;
  dpr: number;
  kdr: number;
  entry: number;
  trade: number;
  objective: number;
  utility: number;
  clutch: number;
}

function computePlusStats(agg: AggregatedSab, all: AggregatedSab[]): PlusStat {
  const rp = agg.rounds_played || 1;

  const avgKpr = leagueAvgPerRound(all, (a) => a.kills);
  const avgApr = leagueAvgPerRound(all, (a) => a.assists);
  const avgDpr = leagueAvgPerRound(all, (a) => a.deaths);

  const kds = all.map((a) => (a.deaths > 0 ? a.kills / a.deaths : a.kills));
  const avgKdr = kds.length > 0 ? kds.reduce((s, v) => s + v, 0) / kds.length : 1;

  const entryRates = all.map((a) => {
    const duels = a.opening_kills + a.opening_deaths;
    return duels > 0 ? a.opening_kills / duels : 0;
  });
  const avgEntryRate = entryRates.length > 0 ? entryRates.reduce((s, v) => s + v, 0) / entryRates.length : 0.5;
  const avgKast = leagueAvgPerRound(all, (a) => a.kast_rounds);
  const avgObjScore = leagueAvgPerRound(all, (a) => 2 * a.plants + 3 * a.defuses);
  const avgUtilScore = leagueAvgPerRound(all, (a) => a.flash_assists + a.utility_damage / 50);
  const avgClutchScore = leagueAvgPerRound(all, (a) => a.clutch_1v1_wins + 2 * a.clutch_1v2_wins);

  return {
    kpr: plusStat(agg.kills / rp, avgKpr),
    apr: plusStat(agg.assists / rp, avgApr),
    dpr: plusStat(agg.deaths / rp, avgDpr),
    kdr: plusStat(agg.deaths > 0 ? agg.kills / agg.deaths : agg.kills, avgKdr),
    entry: plusStat(
      (agg.opening_kills + agg.opening_deaths) > 0
        ? agg.opening_kills / (agg.opening_kills + agg.opening_deaths)
        : 0,
      avgEntryRate,
    ),
    trade: plusStat(agg.kast_rounds / rp, avgKast),
    objective: plusStat((2 * agg.plants + 3 * agg.defuses) / rp, avgObjScore),
    utility: plusStat((agg.flash_assists + agg.utility_damage / 50) / rp, avgUtilScore),
    clutch: plusStat((agg.clutch_1v1_wins + 3 * agg.clutch_1v2_wins) / rp, avgClutchScore),
  };
}

// --- Sorting ---

type SortKey = string;
interface SortState { col: SortKey; asc: boolean }

function useSortState(defaultCol: SortKey): [SortState, (col: SortKey) => void] {
  const [sort, setSort] = useState<SortState>({ col: defaultCol, asc: false });
  const toggle = useCallback(
    (col: SortKey) => setSort((s) => s.col === col ? { col, asc: !s.asc } : { col, asc: false }),
    [],
  );
  return [sort, toggle];
}

function SortableTh({ label, title, sortKey, state, onClick }: {
  label: string; title?: string; sortKey: SortKey; state: SortState; onClick: (key: SortKey) => void;
}) {
  const isActive = state.col === sortKey;
  const arrow = isActive ? (state.asc ? ' ↑' : ' ↓') : '';
  return (
    <th
      title={title}
      onClick={() => onClick(sortKey)}
      className="cursor-pointer select-none px-3 py-2 text-right text-xs font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)] hover:bg-[var(--color-bg-hover)] whitespace-nowrap"
    >
      {label}{arrow}
    </th>
  );
}

// --- Formatting ---

function pct(num: number, den: number): string {
  if (den === 0) return '—';
  return `${Math.round((num / den) * 100)}%`;
}

function fmtNum(v: number, d: number = 0): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(d);
}

function plusStyle(val: number): React.CSSProperties {
  const delta = Math.max(-1, Math.min(1, val - 1));
  const pct = Math.round(Math.abs(delta) * 100);
  if (pct === 0) return {};
  const accent = delta > 0 ? 'var(--color-accent-green-fg)' : 'var(--color-accent-red-fg)';
  return { color: `color-mix(in srgb, ${accent} ${pct}%, var(--color-text-primary))` };
}

function OpeningDuels({ wins, losses }: { wins: number; losses: number }) {
  return (
    <span>
      <span className="text-[var(--color-accent-green-fg)]">{wins}</span>
      <span className="text-[var(--color-text-secondary)]">-</span>
      <span className="text-[var(--color-accent-red-fg)]">{losses}</span>
    </span>
  );
}

function PlayerCell({ id, name }: { id: number; name: string }) {
  return (
    <td className="px-3 py-2">
      <Link href={`/players/${id}`} className="block">{name}</Link>
    </td>
  );
}

const playerThCls = 'px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)]';
const tdRight = 'px-3 py-2 text-right tnum';

// --- Impact Stats ---

function ImpactTable({ aggregated, singlePlayer }: { aggregated: AggregatedSab[]; singlePlayer: boolean }) {
  const [sort, toggleSort] = useSortState('kast');

  const sorted = useMemo(() => {
    const copy = [...aggregated];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      const arp = a.rounds_played || 1;
      const brp = b.rounds_played || 1;
      switch (sort.col) {
        case 'duels': aVal = a.opening_kills - a.opening_deaths; bVal = b.opening_kills - b.opening_deaths; break;
        case 'opening_pct': aVal = (a.opening_kills + a.opening_deaths) / arp; bVal = (b.opening_kills + b.opening_deaths) / brp; break;
        case 'opening_success': aVal = a.opening_kills / ((a.opening_kills + a.opening_deaths) || 1); bVal = b.opening_kills / ((b.opening_kills + b.opening_deaths) || 1); break;
        case 'hs': aVal = a.headshot_kills / (a.kills || 1); bVal = b.headshot_kills / (b.kills || 1); break;
        case 'kast': aVal = a.kast_rounds / arp; bVal = b.kast_rounds / brp; break;
        case '2k': aVal = a.two_k_rounds; bVal = b.two_k_rounds; break;
        case '1v1': aVal = a.clutch_1v1_wins; bVal = b.clutch_1v1_wins; break;
        case '1v2': aVal = a.clutch_1v2_wins; bVal = b.clutch_1v2_wins; break;
        case 'clutch_pct': {
          const aAttempts = a.clutch_1v1_attempts + a.clutch_1v2_attempts;
          const bAttempts = b.clutch_1v1_attempts + b.clutch_1v2_attempts;
          aVal = aAttempts > 0 ? (a.clutch_1v1_wins + a.clutch_1v2_wins) / aAttempts : 0;
          bVal = bAttempts > 0 ? (b.clutch_1v1_wins + b.clutch_1v2_wins) / bAttempts : 0;
          break;
        }
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [aggregated, sort]);

  return (
    <div className="my-6">
      <h3 className="text-sm font-semibold mb-3">Impact</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr>
              {!singlePlayer && <th className={playerThCls}>Player</th>}
              <SortableTh label="Opening Duels" title="First kill and first death of each round (wins-losses)" sortKey="duels" state={sort} onClick={toggleSort} />
              <SortableTh label="Opening %" title="Percentage of rounds where this player took the opening duel" sortKey="opening_pct" state={sort} onClick={toggleSort} />
              <SortableTh label="Opening Success" title="Opening kills / (opening kills + opening deaths)" sortKey="opening_success" state={sort} onClick={toggleSort} />
              <SortableTh label="Headshot %" title="Headshot kill percentage" sortKey="hs" state={sort} onClick={toggleSort} />
              <SortableTh label="KAST" title="Percentage of rounds with a Kill, Assist, Survived, or Traded" sortKey="kast" state={sort} onClick={toggleSort} />
              <SortableTh label="Double Kills" title="Rounds where both opponents were eliminated" sortKey="2k" state={sort} onClick={toggleSort} />
              <SortableTh label="1v1" title="1v1 clutch wins / attempts" sortKey="1v1" state={sort} onClick={toggleSort} />
              <SortableTh label="1v2" title="1v2 clutch wins / attempts" sortKey="1v2" state={sort} onClick={toggleSort} />
              <SortableTh label="Clutch %" title="Overall clutch success rate (1v1 + 1v2 wins / attempts)" sortKey="clutch_pct" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const totalDuels = a.opening_kills + a.opening_deaths;
              const clutchAttempts = a.clutch_1v1_attempts + a.clutch_1v2_attempts;
              const clutchWins = a.clutch_1v1_wins + a.clutch_1v2_wins;
              return (
                <tr key={a.player_id} className="lift-row border-b border-[var(--color-border-secondary)]">
                  {!singlePlayer && <PlayerCell id={a.player_id} name={a.player_name} />}
                  <td className={tdRight}><OpeningDuels wins={a.opening_kills} losses={a.opening_deaths} /></td>
                  <td className={tdRight}>{pct(totalDuels, a.rounds_played)}</td>
                  <td className={tdRight}>{pct(a.opening_kills, totalDuels)}</td>
                  <td className={tdRight}>{pct(a.headshot_kills, a.kills)}</td>
                  <td className={tdRight}>{pct(a.kast_rounds, a.rounds_played)}</td>
                  <td className={tdRight}>{a.two_k_rounds}</td>
                  <td className={tdRight}>{a.clutch_1v1_wins}/{a.clutch_1v1_attempts}</td>
                  <td className={tdRight}>{a.clutch_1v2_wins}/{a.clutch_1v2_attempts}</td>
                  <td className={tdRight}>{pct(clutchWins, clutchAttempts)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Utility Stats ---

function UtilityTable({ aggregated, singlePlayer }: { aggregated: AggregatedSab[]; singlePlayer: boolean }) {
  const [sort, toggleSort] = useSortState('ud');

  const sorted = useMemo(() => {
    const copy = [...aggregated];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sort.col) {
        case 'ud': aVal = a.utility_damage; bVal = b.utility_damage; break;
        case 'fa': aVal = a.flash_assists; bVal = b.flash_assists; break;
        case 'ef': aVal = a.enemies_flashed; bVal = b.enemies_flashed; break;
        case 'pl': aVal = a.plants; bVal = b.plants; break;
        case 'df': aVal = a.defuses; bVal = b.defuses; break;
        case 'ud_r': aVal = a.utility_damage / (a.rounds_played || 1); bVal = b.utility_damage / (b.rounds_played || 1); break;
        case 'fa_r': aVal = a.flash_assists / (a.rounds_played || 1); bVal = b.flash_assists / (b.rounds_played || 1); break;
        case 'ef_r': aVal = a.enemies_flashed / (a.rounds_played || 1); bVal = b.enemies_flashed / (b.rounds_played || 1); break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [aggregated, sort]);

  return (
    <div className="my-6">
      <h3 className="text-sm font-semibold mb-3">Utility</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr>
              {!singlePlayer && <th className={playerThCls}>Player</th>}
              <SortableTh label="Utility Damage" title="Damage dealt with grenades (HE, molotov, incendiary)" sortKey="ud" state={sort} onClick={toggleSort} />
              <SortableTh label="Util Dmg/Round" title="Utility damage per round" sortKey="ud_r" state={sort} onClick={toggleSort} />
              <SortableTh label="Flash Assists" title="Kills by a teammate on an enemy you flashbanged" sortKey="fa" state={sort} onClick={toggleSort} />
              <SortableTh label="Flash Assists/Round" title="Flash assists per round" sortKey="fa_r" state={sort} onClick={toggleSort} />
              <SortableTh label="Enemies Flashed" title="Enemy players blinded by your flashbangs" sortKey="ef" state={sort} onClick={toggleSort} />
              <SortableTh label="Enemies Flashed/Round" title="Enemies flashed per round" sortKey="ef_r" state={sort} onClick={toggleSort} />
              <SortableTh label="Plants" title="Bomb plants" sortKey="pl" state={sort} onClick={toggleSort} />
              <SortableTh label="Defuses" title="Bomb defuses" sortKey="df" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const rp = a.rounds_played || 1;
              return (
                <tr key={a.player_id} className="lift-row border-b border-[var(--color-border-secondary)]">
                  {!singlePlayer && <PlayerCell id={a.player_id} name={a.player_name} />}
                  <td className={tdRight}>{a.utility_damage}</td>
                  <td className={tdRight}>{fmtNum(a.utility_damage / rp, 1)}</td>
                  <td className={tdRight}>{a.flash_assists}</td>
                  <td className={tdRight}>{fmtNum(a.flash_assists / rp, 2)}</td>
                  <td className={tdRight}>{a.enemies_flashed}</td>
                  <td className={tdRight}>{fmtNum(a.enemies_flashed / rp, 2)}</td>
                  <td className={tdRight}>{a.plants}</td>
                  <td className={tdRight}>{a.defuses}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Plus Stats (1-scaled: 1.00 = league average) ---

function PlusStatsTable({ aggregated }: { aggregated: AggregatedSab[] }) {
  const [sort, toggleSort] = useSortState('trade');

  const withPlus = useMemo(() => {
    return aggregated.map((a) => ({ agg: a, plus: computePlusStats(a, aggregated) }));
  }, [aggregated]);

  const sorted = useMemo(() => {
    const copy = [...withPlus];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sort.col) {
        case 'kpr': aVal = a.plus.kpr; bVal = b.plus.kpr; break;
        case 'apr': aVal = a.plus.apr; bVal = b.plus.apr; break;
        case 'dpr': aVal = a.plus.dpr; bVal = b.plus.dpr; break;
        case 'kdr': aVal = a.plus.kdr; bVal = b.plus.kdr; break;
        case 'entry': aVal = a.plus.entry; bVal = b.plus.entry; break;
        case 'trade': aVal = a.plus.trade; bVal = b.plus.trade; break;
        case 'objective': aVal = a.plus.objective; bVal = b.plus.objective; break;
        case 'utility': aVal = a.plus.utility; bVal = b.plus.utility; break;
        case 'clutch': aVal = a.plus.clutch; bVal = b.plus.clutch; break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [withPlus, sort]);

  return (
    <div className="my-6">
      <h3 className="text-sm font-semibold mb-3" title="1.00 = league average. Values above 1 are better than average, below 1 are worse.">Stats Plus</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr>
              <th className={playerThCls}>Player</th>
              <SortableTh label="Kills/Round+" title="Kills per round vs league avg (1.00 = avg)" sortKey="kpr" state={sort} onClick={toggleSort} />
              <SortableTh label="Assists/Round+" title="Assists per round vs league avg (1.00 = avg)" sortKey="apr" state={sort} onClick={toggleSort} />
              <SortableTh label="Deaths/Round+" title="Deaths per round vs league avg (1.00 = avg, lower is better)" sortKey="dpr" state={sort} onClick={toggleSort} />
              <SortableTh label="K/D+" title="K/D ratio vs league avg (1.00 = avg)" sortKey="kdr" state={sort} onClick={toggleSort} />
              <SortableTh label="Entry+" title="Opening duel success rate (OK / total duels) vs league avg (1.00 = avg)" sortKey="entry" state={sort} onClick={toggleSort} />
              <SortableTh label="KAST+" title="KAST per round vs league avg (1.00 = avg)" sortKey="trade" state={sort} onClick={toggleSort} />
              <SortableTh label="Objective+" title="Objective score (2×plants + 3×defuses) per round vs league avg (1.00 = avg)" sortKey="objective" state={sort} onClick={toggleSort} />
              <SortableTh label="Utility+" title="Utility score (flash assists + util damage/50) per round vs league avg (1.00 = avg)" sortKey="utility" state={sort} onClick={toggleSort} />
              <SortableTh label="Clutch+" title="Clutch score (1v1 wins + 3×1v2 wins) per round vs league avg (1.00 = avg)" sortKey="clutch" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ agg, plus }) => (
              <tr key={agg.player_id} className="lift-row border-b border-[var(--color-border-secondary)]">
                <PlayerCell id={agg.player_id} name={agg.player_name} />
                <td className={tdRight} style={plusStyle(plus.kpr)}>{fmtNum(plus.kpr, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.apr)}>{fmtNum(plus.apr, 2)}</td>
                <td className={tdRight} style={plusStyle(2 - plus.dpr)}>{fmtNum(plus.dpr, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.kdr)}>{fmtNum(plus.kdr, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.entry)}>{fmtNum(plus.entry, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.trade)}>{fmtNum(plus.trade, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.objective)}>{fmtNum(plus.objective, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.utility)}>{fmtNum(plus.utility, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.clutch)}>{fmtNum(plus.clutch, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SabremetricsLeaderboardView({
  rows,
  singlePlayer = false,
}: {
  rows: SabremetricMatchRow[];
  singlePlayer?: boolean;
}) {
  const aggregated = useMemo(() => aggregateRows(rows), [rows]);

  if (aggregated.length === 0) {
    return (
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
        No sabremetric data available. Upload demos on match pages to populate advanced stats.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ImpactTable aggregated={aggregated} singlePlayer={singlePlayer} />
      <UtilityTable aggregated={aggregated} singlePlayer={singlePlayer} />
      {!singlePlayer && <PlusStatsTable aggregated={aggregated} />}
    </div>
  );
}
