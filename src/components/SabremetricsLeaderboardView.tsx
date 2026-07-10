'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import type { SabFields } from '@/lib/types';
import { tabCls } from '@/lib/util';
import StatTileGrid, { type StatTile } from './StatTileGrid';

/**
 * The fields this view actually reads off a per-match sabremetric row — a structural subset of
 * `SabremetricMatchRow` (src/lib/queries.ts), so the season/career callers (which pass full
 * `SabremetricMatchRow[]`) satisfy this without any change, and match-page callers can build a
 * lighter-weight row (no season_id/is_gauntlet, which this view never uses) from per-match data.
 */
export interface SabremetricStatRow {
  player_id: number;
  player_name: string;
  match_id: number;
  rounds_played: number;
  sab: SabFields;
}

// Side-tint helper (CT/T, not SHIRTS/SKINS) — matches MatchTabView.tsx's own factionClass(),
// duplicated locally per this codebase's existing pattern of small per-file copies (also
// independently defined in DemoUploadModal.tsx and app/matches/[id]/page.tsx).
type Side = 'CT' | 'T' | null;
function factionClass(side: Side): string {
  if (side === 'CT') return 'faction-ct';
  if (side === 'T') return 'faction-t';
  return '';
}

/** One team's slice of a match-page sabremetrics view — filters the aggregate to its
 *  `playerIds` and wraps it in `header` (typically a `<TeamHeader>`) and side tinting. */
export interface TeamGroup {
  key: string;
  playerIds: Set<number>;
  side: Side;
  header?: React.ReactNode;
}

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
  flashes_leading_to_kill: number;
  utility_damage: number;
  enemies_flashed: number;
  flashes_thrown: number;
  plants: number;
  defuses: number;
  two_k_rounds: number;
  trade_kill_opportunities: number;
  trade_kill_attempts: number;
  trade_kill_successes: number;
  traded_death_opportunities: number;
  traded_death_attempts: number;
  traded_death_successes: number;
  he_thrown: number;
  he_damage: number;
  blind_duration_max_sum: number;
  effective_flashes: number;
  shots_fired: number;
  shots_hit: number;
  headshot_hits: number;
  counter_strafe_shots: number;
  counter_strafe_good_shots: number;
  spray_shots_fired: number;
  spray_shots_hit: number;
  smokes_blocking_push: number;
}

function aggregateRows(rows: SabremetricStatRow[]): AggregatedSab[] {
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
        flash_assists: 0, flashes_leading_to_kill: 0, utility_damage: 0, enemies_flashed: 0, flashes_thrown: 0,
        plants: 0, defuses: 0, two_k_rounds: 0,
        trade_kill_opportunities: 0, trade_kill_attempts: 0, trade_kill_successes: 0,
        traded_death_opportunities: 0, traded_death_attempts: 0, traded_death_successes: 0,
        he_thrown: 0, he_damage: 0,
        blind_duration_max_sum: 0, effective_flashes: 0,
        shots_fired: 0, shots_hit: 0, headshot_hits: 0,
        counter_strafe_shots: 0, counter_strafe_good_shots: 0,
        spray_shots_fired: 0, spray_shots_hit: 0,
        smokes_blocking_push: 0,
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
    agg.flashes_leading_to_kill += s.flashes_leading_to_kill;
    agg.utility_damage += s.utility_damage;
    agg.enemies_flashed += s.enemies_flashed;
    agg.flashes_thrown += s.flashes_thrown;
    agg.plants += s.plants;
    agg.defuses += s.defuses;
    agg.two_k_rounds += s.two_k_rounds;
    agg.trade_kill_opportunities += s.trade_kill_opportunities;
    agg.trade_kill_attempts += s.trade_kill_attempts;
    agg.trade_kill_successes += s.trade_kill_successes;
    agg.traded_death_opportunities += s.traded_death_opportunities;
    agg.traded_death_attempts += s.traded_death_attempts;
    agg.traded_death_successes += s.traded_death_successes;
    agg.he_thrown += s.he_thrown;
    agg.he_damage += s.he_damage;
    agg.blind_duration_max_sum += s.blind_duration_max_sum;
    agg.effective_flashes += s.effective_flashes;
    agg.shots_fired += s.shots_fired;
    agg.shots_hit += s.shots_hit;
    agg.headshot_hits += s.headshot_hits;
    agg.counter_strafe_shots += s.counter_strafe_shots;
    agg.counter_strafe_good_shots += s.counter_strafe_good_shots;
    agg.spray_shots_fired += s.spray_shots_fired;
    agg.spray_shots_hit += s.spray_shots_hit;
    agg.smokes_blocking_push += s.smokes_blocking_push;
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
    <td className="sticky-col px-3 py-2">
      <Link href={`/players/${id}`} className="block">{name}</Link>
    </td>
  );
}

const playerThCls = 'sticky-col px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)]';
const tdRight = 'px-3 py-2 text-right tnum';

// --- Impact Stats ---

function ImpactTable({ aggregated, singlePlayer, showHeading = true }: { aggregated: AggregatedSab[]; singlePlayer: boolean; showHeading?: boolean }) {
  const [sort, toggleSort] = useSortState('kast');

  const sorted = useMemo(() => {
    const copy = [...aggregated];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      const arp = a.rounds_played || 1;
      const brp = b.rounds_played || 1;
      switch (sort.col) {
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
      {showHeading && <h3 className="text-sm font-semibold mb-3">Impact</h3>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className={singlePlayer ? undefined : 'bg-[var(--color-bg-secondary)]'}>
              {!singlePlayer && <th className={playerThCls}>Player</th>}
              <SortableTh label="KAST" title="Percentage of rounds with a Kill, Assist, Survived, or Traded" sortKey="kast" state={sort} onClick={toggleSort} />
              <SortableTh label="Double Kills" title="Rounds where both opponents were eliminated" sortKey="2k" state={sort} onClick={toggleSort} />
              <SortableTh label="1v1" title="1v1 clutch wins / attempts" sortKey="1v1" state={sort} onClick={toggleSort} />
              <SortableTh label="1v2" title="1v2 clutch wins / attempts" sortKey="1v2" state={sort} onClick={toggleSort} />
              <SortableTh label="Clutch %" title="Overall clutch success rate (1v1 + 1v2 wins / attempts)" sortKey="clutch_pct" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const clutchAttempts = a.clutch_1v1_attempts + a.clutch_1v2_attempts;
              const clutchWins = a.clutch_1v1_wins + a.clutch_1v2_wins;
              return (
                <tr key={a.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                  {!singlePlayer && <PlayerCell id={a.player_id} name={a.player_name} />}
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

// --- Opening Duels ---

function OpeningDuelsTable({ aggregated, singlePlayer, showHeading = true }: { aggregated: AggregatedSab[]; singlePlayer: boolean; showHeading?: boolean }) {
  const [sort, toggleSort] = useSortState('opening_success');

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
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [aggregated, sort]);

  return (
    <div className="my-6">
      {showHeading && <h3 className="text-sm font-semibold mb-3">Opening Duels</h3>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className={singlePlayer ? undefined : 'bg-[var(--color-bg-secondary)]'}>
              {!singlePlayer && <th className={playerThCls}>Player</th>}
              <SortableTh label="Opening Duels" title="First kill and first death of each round (wins-losses)" sortKey="duels" state={sort} onClick={toggleSort} />
              <SortableTh label="Opening %" title="Percentage of rounds where this player took the opening duel" sortKey="opening_pct" state={sort} onClick={toggleSort} />
              <SortableTh label="Opening Success" title="Opening kills / (opening kills + opening deaths)" sortKey="opening_success" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const totalDuels = a.opening_kills + a.opening_deaths;
              return (
                <tr key={a.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                  {!singlePlayer && <PlayerCell id={a.player_id} name={a.player_name} />}
                  <td className={tdRight}><OpeningDuels wins={a.opening_kills} losses={a.opening_deaths} /></td>
                  <td className={tdRight}>{pct(totalDuels, a.rounds_played)}</td>
                  <td className={tdRight}>{pct(a.opening_kills, totalDuels)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Mechanics Stats (raw, ungated — see docs/calculations.md) ---

function MechanicsTable({ aggregated, singlePlayer, showHeading = true }: { aggregated: AggregatedSab[]; singlePlayer: boolean; showHeading?: boolean }) {
  const [sort, toggleSort] = useSortState('acc');

  const sorted = useMemo(() => {
    const copy = [...aggregated];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sort.col) {
        case 'shots_fired': aVal = a.shots_fired; bVal = b.shots_fired; break;
        case 'acc': aVal = a.shots_hit / (a.shots_fired || 1); bVal = b.shots_hit / (b.shots_fired || 1); break;
        case 'head_acc': aVal = a.headshot_hits / (a.shots_hit || 1); bVal = b.headshot_hits / (b.shots_hit || 1); break;
        case 'cstrafe':
          aVal = a.counter_strafe_good_shots / (a.counter_strafe_shots || 1);
          bVal = b.counter_strafe_good_shots / (b.counter_strafe_shots || 1);
          break;
        case 'spray':
          aVal = a.spray_shots_hit / (a.spray_shots_fired || 1);
          bVal = b.spray_shots_hit / (b.spray_shots_fired || 1);
          break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [aggregated, sort]);

  return (
    <div className="my-6">
      {showHeading && <h3 className="text-sm font-semibold mb-3">Mechanics</h3>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className={singlePlayer ? undefined : 'bg-[var(--color-bg-secondary)]'}>
              {!singlePlayer && <th className={playerThCls}>Player</th>}
              <SortableTh label="Shots Fired" title="Shots fired (guns only, not gated on enemy visibility)" sortKey="shots_fired" state={sort} onClick={toggleSort} />
              <SortableTh label="Accuracy" title="Shots that hit an enemy / shots fired (guns only, not gated on enemy visibility)" sortKey="acc" state={sort} onClick={toggleSort} />
              <SortableTh label="Head Accuracy" title="Hits landing on the head / total hits" sortKey="head_acc" state={sort} onClick={toggleSort} />
              <SortableTh label="Counter-Strafe %" title="Rifle shots fired at under 34% of max speed / all standing rifle shots (crouched shots excluded)" sortKey="cstrafe" state={sort} onClick={toggleSort} />
              <SortableTh label="Spray Accuracy" title="Hits / shots within sequences of 3+ consecutive rifle shots" sortKey="spray" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <tr key={a.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                {!singlePlayer && <PlayerCell id={a.player_id} name={a.player_name} />}
                <td className={tdRight}>{a.shots_fired}</td>
                <td className={tdRight}>{pct(a.shots_hit, a.shots_fired)}</td>
                <td className={tdRight}>{pct(a.headshot_hits, a.shots_hit)}</td>
                <td className={tdRight}>{pct(a.counter_strafe_good_shots, a.counter_strafe_shots)}</td>
                <td className={tdRight}>{pct(a.spray_shots_hit, a.spray_shots_fired)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Trade Stats ---

function TradesTable({ aggregated, singlePlayer, showHeading = true }: { aggregated: AggregatedSab[]; singlePlayer: boolean; showHeading?: boolean }) {
  const [sort, toggleSort] = useSortState('trade_kill_pct');

  const sorted = useMemo(() => {
    const copy = [...aggregated];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sort.col) {
        case 'trade_kill_opp': aVal = a.trade_kill_opportunities; bVal = b.trade_kill_opportunities; break;
        case 'trade_kill_att': aVal = a.trade_kill_attempts; bVal = b.trade_kill_attempts; break;
        case 'trade_kill_succ': aVal = a.trade_kill_successes; bVal = b.trade_kill_successes; break;
        case 'trade_kill_pct':
          aVal = a.trade_kill_successes / (a.trade_kill_attempts || 1);
          bVal = b.trade_kill_successes / (b.trade_kill_attempts || 1);
          break;
        case 'traded_death_opp': aVal = a.traded_death_opportunities; bVal = b.traded_death_opportunities; break;
        case 'traded_death_att': aVal = a.traded_death_attempts; bVal = b.traded_death_attempts; break;
        case 'traded_death_succ': aVal = a.traded_death_successes; bVal = b.traded_death_successes; break;
        case 'traded_death_pct':
          aVal = a.traded_death_successes / (a.traded_death_attempts || 1);
          bVal = b.traded_death_successes / (b.traded_death_attempts || 1);
          break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [aggregated, sort]);

  return (
    <div className="my-6">
      {showHeading && <h3 className="text-sm font-semibold mb-3">Trades</h3>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className={singlePlayer ? undefined : 'bg-[var(--color-bg-secondary)]'}>
              {!singlePlayer && <th className={playerThCls}>Player</th>}
              <SortableTh label="Trade Kill Opps" title="Trade kill opportunities: times a teammate died while this player was still alive (the chance to trade existed)" sortKey="trade_kill_opp" state={sort} onClick={toggleSort} />
              <SortableTh label="Trade Kill Attempts" title="Trade kill attempts: opportunities where this player damaged the killer within the trade window" sortKey="trade_kill_att" state={sort} onClick={toggleSort} />
              <SortableTh label="Trade Kills" title="Trade kill successes: opportunities where this player killed the killer within the trade window" sortKey="trade_kill_succ" state={sort} onClick={toggleSort} />
              <SortableTh label="Trade Kill %" title="Trade kill successes / attempts" sortKey="trade_kill_pct" state={sort} onClick={toggleSort} />
              <SortableTh label="Traded Death Opps" title="Traded death opportunities: times this player died while at least one teammate was still alive (someone had the chance to trade them)" sortKey="traded_death_opp" state={sort} onClick={toggleSort} />
              <SortableTh label="Traded Death Attempts" title="Traded death attempts: opportunities where a teammate damaged the killer within the trade window" sortKey="traded_death_att" state={sort} onClick={toggleSort} />
              <SortableTh label="Traded Deaths" title="Traded death successes: opportunities where a teammate killed the killer within the trade window" sortKey="traded_death_succ" state={sort} onClick={toggleSort} />
              <SortableTh label="Traded Death %" title="Traded death successes / attempts" sortKey="traded_death_pct" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <tr key={a.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                {!singlePlayer && <PlayerCell id={a.player_id} name={a.player_name} />}
                <td className={tdRight}>{a.trade_kill_opportunities}</td>
                <td className={tdRight}>{a.trade_kill_attempts}</td>
                <td className={tdRight}>{a.trade_kill_successes}</td>
                <td className={tdRight}>{pct(a.trade_kill_successes, a.trade_kill_attempts)}</td>
                <td className={tdRight}>{a.traded_death_opportunities}</td>
                <td className={tdRight}>{a.traded_death_attempts}</td>
                <td className={tdRight}>{a.traded_death_successes}</td>
                <td className={tdRight}>{pct(a.traded_death_successes, a.traded_death_attempts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Utility Stats ---

function UtilityTable({ aggregated, singlePlayer, showHeading = true }: { aggregated: AggregatedSab[]; singlePlayer: boolean; showHeading?: boolean }) {
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
        case 'fltk': aVal = a.flashes_leading_to_kill; bVal = b.flashes_leading_to_kill; break;
        case 'ef_r': aVal = a.enemies_flashed / (a.rounds_played || 1); bVal = b.enemies_flashed / (b.rounds_played || 1); break;
        case 'ef_flash':
          aVal = a.enemies_flashed / (a.flashes_thrown || 1);
          bVal = b.enemies_flashed / (b.flashes_thrown || 1);
          break;
        case 'blind_flash':
          aVal = a.blind_duration_max_sum / (a.effective_flashes || 1);
          bVal = b.blind_duration_max_sum / (b.effective_flashes || 1);
          break;
        case 'he_thrown': aVal = a.he_thrown; bVal = b.he_thrown; break;
        case 'he_dmg': aVal = a.he_damage; bVal = b.he_damage; break;
        case 'he_dmg_throw':
          aVal = a.he_damage / (a.he_thrown || 1);
          bVal = b.he_damage / (b.he_thrown || 1);
          break;
        case 'smoke_block': aVal = a.smokes_blocking_push; bVal = b.smokes_blocking_push; break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [aggregated, sort]);

  return (
    <div className="my-6">
      {showHeading && <h3 className="text-sm font-semibold mb-3">Utility</h3>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className={singlePlayer ? undefined : 'bg-[var(--color-bg-secondary)]'}>
              {!singlePlayer && <th className={playerThCls}>Player</th>}
              <SortableTh label="Utility Damage" title="Damage dealt with grenades (HE, molotov, incendiary)" sortKey="ud" state={sort} onClick={toggleSort} />
              <SortableTh label="Util Dmg/Round" title="Utility damage per round" sortKey="ud_r" state={sort} onClick={toggleSort} />
              <SortableTh label="Flash Assists" title="Kills by a teammate on an enemy you flashbanged" sortKey="fa" state={sort} onClick={toggleSort} />
              <SortableTh label="Flash Assists/Round" title="Flash assists per round" sortKey="fa_r" state={sort} onClick={toggleSort} />
              <SortableTh label="Flashes → Kill" title="Enemies killed by anyone (including you) while still blinded by your flash — Leetify's flash-effectiveness definition" sortKey="fltk" state={sort} onClick={toggleSort} />
              <SortableTh label="Enemies Flashed" title="Enemy players blinded by your flashbangs" sortKey="ef" state={sort} onClick={toggleSort} />
              <SortableTh label="Enemies Flashed/Round" title="Enemies flashed per round" sortKey="ef_r" state={sort} onClick={toggleSort} />
              <SortableTh label="Enemies Flashed/Flash" title="Enemies flashed (1.1s+) per flashbang thrown" sortKey="ef_flash" state={sort} onClick={toggleSort} />
              <SortableTh label="Avg Blind/Flash" title="Longest blind duration caused, averaged over flashes that blinded at least one enemy for 1.1s+" sortKey="blind_flash" state={sort} onClick={toggleSort} />
              <SortableTh label="Plants" title="Bomb plants" sortKey="pl" state={sort} onClick={toggleSort} />
              <SortableTh label="Defuses" title="Bomb defuses" sortKey="df" state={sort} onClick={toggleSort} />
              <SortableTh label="HE Thrown" title="HE grenades thrown" sortKey="he_thrown" state={sort} onClick={toggleSort} />
              <SortableTh label="HE Damage" title="Damage dealt to enemies by HE grenades" sortKey="he_dmg" state={sort} onClick={toggleSort} />
              <SortableTh label="HE Dmg/Throw" title="HE damage per HE grenade thrown" sortKey="he_dmg_throw" state={sort} onClick={toggleSort} />
              <SortableTh label="Smokes Blocking" title="Smokes thrown that had an enemy within ~800 units of the bloom at some point during its life" sortKey="smoke_block" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const rp = a.rounds_played || 1;
              return (
                <tr key={a.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                  {!singlePlayer && <PlayerCell id={a.player_id} name={a.player_name} />}
                  <td className={tdRight}>{a.utility_damage}</td>
                  <td className={tdRight}>{fmtNum(a.utility_damage / rp, 1)}</td>
                  <td className={tdRight}>{a.flash_assists}</td>
                  <td className={tdRight}>{fmtNum(a.flash_assists / rp, 2)}</td>
                  <td className={tdRight}>{a.flashes_leading_to_kill}</td>
                  <td className={tdRight}>{a.enemies_flashed}</td>
                  <td className={tdRight}>{fmtNum(a.enemies_flashed / rp, 2)}</td>
                  <td className={tdRight}>{fmtNum(a.enemies_flashed / (a.flashes_thrown || 1), 2)}</td>
                  <td className={tdRight}>{fmtNum(a.blind_duration_max_sum / (a.effective_flashes || 1), 2)}</td>
                  <td className={tdRight}>{a.plants}</td>
                  <td className={tdRight}>{a.defuses}</td>
                  <td className={tdRight}>{a.he_thrown}</td>
                  <td className={tdRight}>{a.he_damage}</td>
                  <td className={tdRight}>{fmtNum(a.he_damage / (a.he_thrown || 1), 1)}</td>
                  <td className={tdRight}>{a.smokes_blocking_push}</td>
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
            <tr className="bg-[var(--color-bg-secondary)]">
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
              <tr key={agg.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
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

// --- Single-player layout ---
//
// A one-row table is awkward (lots of columns, a single line of data, forced
// horizontal scroll on mobile). For a single player we transpose the same
// metrics into a label/value stat-tile grid — the shared `StatTileGrid`, so it
// matches the player Overview panel exactly. See docs/visual-conventions.md.

interface SinglePlayerTiles {
  impact: StatTile[];
  duels: StatTile[];
  mechanics: StatTile[];
  trades: StatTile[];
  utility: StatTile[];
  plus: StatTile[];
}

function buildSinglePlayerTiles(agg: AggregatedSab, leagueAggregated: AggregatedSab[]): SinglePlayerTiles {
  const rp = agg.rounds_played || 1;
  const totalDuels = agg.opening_kills + agg.opening_deaths;
  const clutchAttempts = agg.clutch_1v1_attempts + agg.clutch_1v2_attempts;
  const clutchWins = agg.clutch_1v1_wins + agg.clutch_1v2_wins;

  const duels: StatTile[] = [
    { label: 'Opening Duels', title: 'First kill and first death of each round (wins-losses)', value: <OpeningDuels wins={agg.opening_kills} losses={agg.opening_deaths} /> },
    { label: 'Opening %', title: 'Percentage of rounds where this player took the opening duel', value: pct(totalDuels, agg.rounds_played) },
    { label: 'Opening Success', title: 'Opening kills / (opening kills + opening deaths)', value: pct(agg.opening_kills, totalDuels) },
  ];

  const impact: StatTile[] = [
    { label: 'KAST', title: 'Percentage of rounds with a Kill, Assist, Survived, or Traded', value: pct(agg.kast_rounds, agg.rounds_played) },
    { label: 'Double Kills', title: 'Rounds where both opponents were eliminated', value: agg.two_k_rounds },
    { label: '1v1 Clutches', title: '1v1 clutch wins / attempts', value: `${agg.clutch_1v1_wins}/${agg.clutch_1v1_attempts}` },
    { label: '1v2 Clutches', title: '1v2 clutch wins / attempts', value: `${agg.clutch_1v2_wins}/${agg.clutch_1v2_attempts}` },
    { label: 'Clutch %', title: 'Overall clutch success rate (1v1 + 1v2 wins / attempts)', value: pct(clutchWins, clutchAttempts) },
  ];

  const mechanics: StatTile[] = [
    { label: 'Shots Fired', title: 'Shots fired (guns only, not gated on enemy visibility)', value: agg.shots_fired },
    { label: 'Accuracy', title: 'Shots that hit an enemy / shots fired (guns only, not gated on enemy visibility)', value: pct(agg.shots_hit, agg.shots_fired) },
    { label: 'Head Accuracy', title: 'Hits landing on the head / total hits', value: pct(agg.headshot_hits, agg.shots_hit) },
    { label: 'Counter-Strafe %', title: 'Rifle shots fired at under 34% of max speed / all standing rifle shots (crouched shots excluded)', value: pct(agg.counter_strafe_good_shots, agg.counter_strafe_shots) },
    { label: 'Spray Accuracy', title: 'Hits / shots within sequences of 3+ consecutive rifle shots', value: pct(agg.spray_shots_hit, agg.spray_shots_fired) },
  ];

  const trades: StatTile[] = [
    { label: 'Trade Kill Opps', title: 'Trade kill opportunities: times a teammate died while this player was still alive (the chance to trade existed)', value: agg.trade_kill_opportunities },
    { label: 'Trade Kill Attempts', title: 'Trade kill attempts: opportunities where this player damaged the killer within the trade window', value: agg.trade_kill_attempts },
    { label: 'Trade Kills', title: 'Trade kill successes / attempts: times you killed the enemy who killed your teammate, out of the times you tried to', value: `${agg.trade_kill_successes}/${agg.trade_kill_attempts}` },
    { label: 'Traded Death Opps', title: 'Traded death opportunities: times this player died while at least one teammate was still alive (someone had the chance to trade them)', value: agg.traded_death_opportunities },
    { label: 'Traded Death Attempts', title: 'Traded death attempts: opportunities where a teammate damaged the killer within the trade window', value: agg.traded_death_attempts },
    { label: 'Traded Deaths', title: 'Traded death successes / attempts: times a teammate killed the enemy who killed you, out of the times a teammate tried to', value: `${agg.traded_death_successes}/${agg.traded_death_attempts}` },
  ];

  const utility: StatTile[] = [
    { label: 'Utility Damage', title: 'Damage dealt with grenades (HE, molotov, incendiary)', value: agg.utility_damage },
    { label: 'Util Dmg/Round', title: 'Utility damage per round', value: fmtNum(agg.utility_damage / rp, 1) },
    { label: 'Flash Assists', title: 'Kills by a teammate on an enemy you flashbanged', value: agg.flash_assists },
    { label: 'Flash Assists/Round', title: 'Flash assists per round', value: fmtNum(agg.flash_assists / rp, 2) },
    { label: 'Flashes → Kill', title: 'Enemies killed by anyone (including you) while still blinded by your flash — Leetify\'s flash-effectiveness definition', value: agg.flashes_leading_to_kill },
    { label: 'Enemies Flashed', title: 'Enemy players blinded by your flashbangs', value: agg.enemies_flashed },
    { label: 'Enemies Flashed/Round', title: 'Enemies flashed per round', value: fmtNum(agg.enemies_flashed / rp, 2) },
    { label: 'Enemies Flashed/Flash', title: 'Enemies flashed (1.1s+) per flashbang thrown', value: fmtNum(agg.enemies_flashed / (agg.flashes_thrown || 1), 2) },
    { label: 'Avg Blind/Flash', title: 'Longest blind duration caused, averaged over flashes that blinded at least one enemy for 1.1s+', value: fmtNum(agg.blind_duration_max_sum / (agg.effective_flashes || 1), 2) },
    { label: 'Plants', title: 'Bomb plants', value: agg.plants },
    { label: 'Defuses', title: 'Bomb defuses', value: agg.defuses },
    { label: 'HE Thrown', title: 'HE grenades thrown', value: agg.he_thrown },
    { label: 'HE Damage', title: 'Damage dealt to enemies by HE grenades', value: agg.he_damage },
    { label: 'HE Dmg/Throw', title: 'HE damage per HE grenade thrown', value: fmtNum(agg.he_damage / (agg.he_thrown || 1), 1) },
    { label: 'Smokes Blocking', title: 'Smokes thrown that had an enemy within ~800 units of the bloom at some point during its life', value: agg.smokes_blocking_push },
  ];

  // Plus stats need the league as a baseline; comparing a player to only
  // themselves yields all 1.00, so only render when we have other players.
  const hasLeagueBaseline = leagueAggregated.length > 1;
  const plus = hasLeagueBaseline ? computePlusStats(agg, leagueAggregated) : null;
  const plusTiles: StatTile[] = plus ? [
    { label: 'Kills/Round+', title: 'Kills per round vs league avg (1.00 = avg)', value: fmtNum(plus.kpr, 2), valueStyle: plusStyle(plus.kpr) },
    { label: 'Assists/Round+', title: 'Assists per round vs league avg (1.00 = avg)', value: fmtNum(plus.apr, 2), valueStyle: plusStyle(plus.apr) },
    { label: 'Deaths/Round+', title: 'Deaths per round vs league avg (1.00 = avg, lower is better)', value: fmtNum(plus.dpr, 2), valueStyle: plusStyle(2 - plus.dpr) },
    { label: 'K/D+', title: 'K/D ratio vs league avg (1.00 = avg)', value: fmtNum(plus.kdr, 2), valueStyle: plusStyle(plus.kdr) },
    { label: 'Entry+', title: 'Opening duel success rate (OK / total duels) vs league avg (1.00 = avg)', value: fmtNum(plus.entry, 2), valueStyle: plusStyle(plus.entry) },
    { label: 'KAST+', title: 'KAST per round vs league avg (1.00 = avg)', value: fmtNum(plus.trade, 2), valueStyle: plusStyle(plus.trade) },
    { label: 'Objective+', title: 'Objective score (2×plants + 3×defuses) per round vs league avg (1.00 = avg)', value: fmtNum(plus.objective, 2), valueStyle: plusStyle(plus.objective) },
    { label: 'Utility+', title: 'Utility score (flash assists + util damage/50) per round vs league avg (1.00 = avg)', value: fmtNum(plus.utility, 2), valueStyle: plusStyle(plus.utility) },
    { label: 'Clutch+', title: 'Clutch score (1v1 wins + 3×1v2 wins) per round vs league avg (1.00 = avg)', value: fmtNum(plus.clutch, 2), valueStyle: plusStyle(plus.clutch) },
  ] : [];

  return { impact, duels, mechanics, trades, utility, plus: plusTiles };
}

// --- Sub-tabs ---
//
// Five sections is too much to stack on one page (both the wide multi-player tables and the
// single-player tile grids) — see the Impact/Mechanics/Trades split above. One tab state drives
// both render paths so they never drift out of sync with each other.

type SubTab = 'impact' | 'duels' | 'mechanics' | 'trades' | 'utility' | 'plus';

// Ordered to roughly match Leetify's match-page grouping (Aim, then situational Duels/Trades,
// then Impact, then Utility) — see #173's Leetify-parity discussion. Stats Plus has no Leetify
// analog (it's DGLS's own league-relative composite), so it stays last.
const ALL_SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'mechanics', label: 'Aim' },
  { key: 'duels', label: 'Opening Duels' },
  { key: 'trades', label: 'Trades' },
  { key: 'impact', label: 'Impact' },
  { key: 'utility', label: 'Utility' },
  { key: 'plus', label: 'Stats Plus' },
];

/** Renders `render(agg)` once per `groups`, filtered to that group's `playerIds` and wrapped in
 *  its `header` (typically a `<TeamHeader>`, supplied by the caller) and side tint — the
 *  match-page shape. Falls back to a single ungrouped `render(aggregated)` call for the
 *  season/career leaderboard shape, where `groups` is omitted. */
function GroupedOrFlat({
  aggregated,
  groups,
  render,
}: {
  aggregated: AggregatedSab[];
  groups?: TeamGroup[];
  render: (agg: AggregatedSab[]) => React.ReactNode;
}) {
  if (!groups) return <>{render(aggregated)}</>;
  return (
    <>
      {groups.map((g, i) => (
        <div key={g.key} className={i > 0 ? 'mt-6' : undefined}>
          {g.header}
          <div className={`faction-tint ${factionClass(g.side)}`}>
            {render(aggregated.filter((a) => g.playerIds.has(a.player_id)))}
          </div>
        </div>
      ))}
    </>
  );
}

export default function SabremetricsLeaderboardView({
  rows,
  leagueRows,
  singlePlayer = false,
  teamGroups,
  showPlusStats = true,
}: {
  rows: SabremetricStatRow[];
  /** League-wide rows used as the Plus-stat baseline in single-player mode. Defaults to `rows`. */
  leagueRows?: SabremetricStatRow[];
  singlePlayer?: boolean;
  /** Match-page mode: split the tables into per-team blocks instead of one flat leaderboard.
   *  Ignored in singlePlayer mode. */
  teamGroups?: TeamGroup[];
  /** Plus stats compare a player to a league-wide baseline — not meaningful over just the
   *  handful of players in one match, so match-page callers should pass `false`. */
  showPlusStats?: boolean;
}) {
  const aggregated = useMemo(() => aggregateRows(rows), [rows]);
  const leagueAggregated = useMemo(() => aggregateRows(leagueRows ?? rows), [leagueRows, rows]);
  const subTabs = showPlusStats ? ALL_SUB_TABS : ALL_SUB_TABS.filter((t) => t.key !== 'plus');
  const [sub, setSub] = useState<SubTab>('mechanics');

  if (aggregated.length === 0) {
    return (
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
        No sabremetric data available. Upload demos on match pages to populate advanced stats.
      </div>
    );
  }

  const tabBar = (
    <div className="flex flex-wrap items-center gap-2">
      {subTabs.map((t) => (
        <button key={t.key} type="button" className={tabCls(sub === t.key)} onClick={() => setSub(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );

  if (singlePlayer) {
    const tiles = buildSinglePlayerTiles(aggregated[0], leagueAggregated);
    return (
      <div className="space-y-4">
        {tabBar}
        {sub === 'impact' && <StatTileGrid heading="Impact" tiles={tiles.impact} />}
        {sub === 'duels' && <StatTileGrid heading="Opening Duels" tiles={tiles.duels} />}
        {sub === 'mechanics' && <StatTileGrid heading="Mechanics" tiles={tiles.mechanics} />}
        {sub === 'trades' && <StatTileGrid heading="Trades" tiles={tiles.trades} />}
        {sub === 'utility' && <StatTileGrid heading="Utility" tiles={tiles.utility} />}
        {sub === 'plus' && tiles.plus.length > 0 && (
          <StatTileGrid heading="Stats Plus" hint="1.00 = league average. Values above 1 are better than average, below 1 are worse." tiles={tiles.plus} />
        )}
      </div>
    );
  }

  const showHeading = !teamGroups;

  return (
    <div className="space-y-4">
      {tabBar}
      {sub === 'impact' && (
        <GroupedOrFlat aggregated={aggregated} groups={teamGroups} render={(agg) => (
          <ImpactTable aggregated={agg} singlePlayer={singlePlayer} showHeading={showHeading} />
        )} />
      )}
      {sub === 'duels' && (
        <GroupedOrFlat aggregated={aggregated} groups={teamGroups} render={(agg) => (
          <OpeningDuelsTable aggregated={agg} singlePlayer={singlePlayer} showHeading={showHeading} />
        )} />
      )}
      {sub === 'mechanics' && (
        <GroupedOrFlat aggregated={aggregated} groups={teamGroups} render={(agg) => (
          <MechanicsTable aggregated={agg} singlePlayer={singlePlayer} showHeading={showHeading} />
        )} />
      )}
      {sub === 'trades' && (
        <GroupedOrFlat aggregated={aggregated} groups={teamGroups} render={(agg) => (
          <TradesTable aggregated={agg} singlePlayer={singlePlayer} showHeading={showHeading} />
        )} />
      )}
      {sub === 'utility' && (
        <GroupedOrFlat aggregated={aggregated} groups={teamGroups} render={(agg) => (
          <UtilityTable aggregated={agg} singlePlayer={singlePlayer} showHeading={showHeading} />
        )} />
      )}
      {sub === 'plus' && showPlusStats && <PlusStatsTable aggregated={aggregated} />}
    </div>
  );
}
