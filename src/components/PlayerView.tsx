'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { PlayerHistoryRow, TrophyEntry, H2HData, EhogRatingPoint } from '@/lib/queries';
import type { LeaderboardRowWithId } from '@/lib/types';
import { extractSeasonNumber, isPlayedScore, seasonTitle, tabCls } from '@/lib/util';
import { aggregatePlayerMapStats, aggregatePlayerSideStats, type PlayerMapStat, type PlayerSideStat } from '@/lib/mapSideStats';
import { mapSlug } from '@/lib/maps';
import DevGate from './DevGate';
import { MatchCard } from './MatchCard';
import LeaderboardTable from './LeaderboardTable';
import { useSeasonFilter, SeasonFilter } from './SeasonFilter';
import Sparkline from './Sparkline';
import { CountdownTimer } from './CountdownTimer';
import MatchupsTab from './MatchupsTab';
import EhogTimeline from './EhogTimeline';

type Filter = 'career' | number;
type MapSortCol = 'map' | 'record' | 'wr' | 'rwr' | 'adr';
type PlayerTab = 'stats' | 'matches' | 'trophies' | 'matchups';
type MatchesSubTab = 'history' | 'upcoming';

const MEDAL_COLORS: Record<1 | 2 | 3, string> = {
  1: '#f5c542',
  2: '#a0a3ab',
  3: '#c47a3a',
};
const MEDAL_ICONS: Record<1 | 2 | 3, string> = {
  1: '🥇',
  2: '🥈',
  3: '🥉',
};
const REGULAR_PLACEMENTS: Record<1 | 2 | 3, string> = {
  1: '1st Place',
  2: '2nd Place',
  3: '3rd Place',
};
const GAUNTLET_PLACEMENTS: Record<1 | 2 | 3, string> = {
  1: 'Champion',
  2: '2nd Place',
  3: '3rd Place',
};

interface Aggregate {
  matches: number;
  wins: number;
  losses: number;
  wr: number;
  kills: number;
  assists: number;
  deaths: number;
  kd: number;
  damage: number;
  rounds_played: number;
  rounds_won: number;
  rwr: number;
  adr: number;
  kills_in_wins: number;
  deaths_in_wins: number;
  kills_in_losses: number;
  deaths_in_losses: number;
}

function isPlayed(r: PlayerHistoryRow): boolean {
  return isPlayedScore(r.final_score) && r.rounds_played > 0;
}

function aggregate(rowsRaw: PlayerHistoryRow[]): Aggregate {
  const rows = rowsRaw.filter(isPlayed);
  const matches = rows.length;
  const wins = rows.filter((r) => r.is_win).length;
  const losses = matches - wins;
  const kills = rows.reduce((s, r) => s + r.kills, 0);
  const assists = rows.reduce((s, r) => s + r.assists, 0);
  const deaths = rows.reduce((s, r) => s + r.deaths, 0);
  const damage = rows.reduce((s, r) => s + r.damage, 0);
  const rounds_played = rows.reduce((s, r) => s + r.rounds_played, 0);
  const rounds_won = rows.reduce((s, r) => s + r.rounds_won, 0);
  const kills_in_wins = rows.reduce((s, r) => s + (r.is_win ? r.kills : 0), 0);
  const deaths_in_wins = rows.reduce((s, r) => s + (r.is_win ? r.deaths : 0), 0);
  const kills_in_losses = rows.reduce((s, r) => s + (r.is_win ? 0 : r.kills), 0);
  const deaths_in_losses = rows.reduce((s, r) => s + (r.is_win ? 0 : r.deaths), 0);
  return {
    matches,
    wins,
    losses,
    wr: matches > 0 ? (wins / matches) * 100 : 0,
    kills,
    assists,
    deaths,
    kd: deaths > 0 ? kills / deaths : kills,
    damage,
    rounds_played,
    rounds_won,
    rwr: rounds_played > 0 ? (rounds_won / rounds_played) * 100 : 0,
    adr: rounds_played > 0 ? damage / rounds_played : 0,
    kills_in_wins,
    deaths_in_wins,
    kills_in_losses,
    deaths_in_losses,
  };
}

interface MapAgg {
  map: string;
  wins: number;
  losses: number;
  wr: number;
  rwr: number;
  adr: number;
}

function aggregateByMap(rows: PlayerHistoryRow[]): MapAgg[] {
  const buckets = new Map<string, { display: string; rows: PlayerHistoryRow[] }>();
  for (const r of rows) {
    if (!r.map) continue;
    const key = r.map.trim().toLowerCase();
    const entry = buckets.get(key) ?? { display: r.map.trim(), rows: [] };
    entry.rows.push(r);
    buckets.set(key, entry);
  }
  const out: MapAgg[] = [];
  for (const { display, rows: list } of buckets.values()) {
    const a = aggregate(list);
    if (a.matches === 0) continue;
    out.push({ map: display, wins: a.wins, losses: a.losses, wr: a.wr, rwr: a.rwr, adr: a.adr });
  }
  return out.sort((a, b) => b.wr - a.wr || b.adr - a.adr);
}

/** Percentage of `all` strictly below `value` — "you're ahead of N% of the league". */
function percentileOf(value: number, all: number[]): number {
  if (all.length === 0) return 0;
  const below = all.filter((v) => v < value).length;
  return Math.round((below / all.length) * 100);
}

function PctRow({ label, pct, value }: { label: string; pct: number; value: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="grid grid-cols-[62px_1fr_50px] items-center gap-2.5 py-1.5">
      <span className="tracked text-[9px] text-[var(--color-text-secondary)]">{label}</span>
      <div className="relative">
        <span className="block h-[6px] w-full bg-[rgba(255,255,255,0.08)]">
          <span className="block h-full bg-[var(--color-ct)]" style={{ width: `${clamped}%` }} />
        </span>
        <span className="absolute left-1/2 -top-0.5 -bottom-0.5 w-px bg-[rgba(255,255,255,0.25)]" />
      </div>
      <span className="font-mono text-[10px] text-right text-[var(--color-text-primary)]">{value}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="tracked text-[10px] text-[var(--color-text-secondary)] mt-10 mb-3">
      {children}
    </div>
  );
}

function SortableTh({ label, colKey, activeCol, asc, align = 'right', onClick }: {
  label: string; colKey: string; activeCol: string; asc: boolean;
  align?: 'left' | 'right'; onClick: (col: string) => void;
}) {
  const active = colKey === activeCol;
  return (
    <th
      tabIndex={0}
      onClick={() => onClick(colKey)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(colKey); } }}
      aria-sort={active ? (asc ? 'ascending' : 'descending') : 'none'}
      className={`tracked text-[10px] font-semibold py-2.5 px-3 border-b border-[var(--color-border-primary)] cursor-pointer select-none whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)] ${align === 'left' ? 'text-left pl-4' : 'text-right'} ${active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
    >
      {label}<span className={`ml-1 ${active ? 'opacity-100' : 'opacity-30'}`}>{active ? (asc ? '↑' : '↓') : '↕'}</span>
    </th>
  );
}

function StatCell({ v, l }: { v: string | number; l: string }) {
  return (
    <div className="px-3 py-3 border-r border-[var(--color-border-tertiary)] last:border-r-0">
      <div className="tracked text-[9px] text-[var(--color-text-secondary)] mb-1">
        {l}
      </div>
      <div className="font-display text-[20px] font-semibold tnum leading-none">
        {v}
      </div>
    </div>
  );
}


export default function PlayerView({
  playerId,
  history,
  trophies,
  careerLeaderboard,
  h2hData,
  ehogHistory,
}: {
  playerId: number;
  history: PlayerHistoryRow[];
  trophies: TrophyEntry[];
  careerLeaderboard: LeaderboardRowWithId[];
  h2hData: H2HData;
  ehogHistory: EhogRatingPoint[];
}) {
  const { regularSeasons, gauntletSeasons, regularToGauntlet } = useMemo(() => {
    const regMap = new Map<number, { id: number; name: string }>();
    const gntMap = new Map<number, { id: number; name: string }>();
    for (const r of history) {
      (r.is_gauntlet ? gntMap : regMap).set(r.season_id, { id: r.season_id, name: r.season_name });
    }
    const reg = Array.from(regMap.values()).sort((a, b) => a.id - b.id);
    const gnt = Array.from(gntMap.values()).sort((a, b) => a.id - b.id);
    const r2g = new Map<number, number>();
    for (const r of reg) {
      const n = extractSeasonNumber(r.name);
      if (n == null) continue;
      const g = gnt.find((s) => extractSeasonNumber(s.name) === n);
      if (g) r2g.set(r.id, g.id);
    }
    return { regularSeasons: reg, gauntletSeasons: gnt, regularToGauntlet: r2g };
  }, [history]);

  const { includeRegular, includeGauntlet, toggleRegular: baseToggleRegular, toggleGauntlet: baseToggleGauntlet } = useSeasonFilter();
  const [filter, setFilter] = useState<Filter>('career');
  const [tab, setTab] = useState<PlayerTab>('stats');
  const [matchesSubTab, setMatchesSubTab] = useState<MatchesSubTab>('history');
  const [mapSort, setMapSort] = useState<MapSortCol>('wr');
  const [mapAsc, setMapAsc] = useState(false);

  function toggleRegular() { baseToggleRegular(); setFilter('career'); }
  function toggleGauntlet() { baseToggleGauntlet(); setFilter('career'); }

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

  function clickMapSort(col: string) {
    const c = col as MapSortCol;
    if (c === mapSort) setMapAsc(!mapAsc);
    else { setMapSort(c); setMapAsc(c === 'map'); }
  }

  const filtered = useMemo(() => {
    const base = filter === 'career'
      ? history
      : (() => {
          const pairedGntId = regularToGauntlet.get(filter);
          return history.filter((r) =>
            r.season_id === filter ||
            (pairedGntId != null && r.season_id === pairedGntId),
          );
        })();
    return base.filter((r) =>
      r.is_gauntlet ? includeGauntlet : includeRegular,
    );
  }, [filter, history, includeRegular, includeGauntlet, regularToGauntlet]);

  const last5 = useMemo(() => filtered.filter(isPlayed).slice(0, 5), [filtered]);

  const filteredTrophies = useMemo(() => {
    const base = filter === 'career'
      ? trophies
      : (() => {
          const pairedGntId = regularToGauntlet.get(filter);
          return trophies.filter((t) =>
            t.season_id === filter ||
            (pairedGntId != null && t.season_id === pairedGntId),
          );
        })();
    return base.filter((t) => (t.is_gauntlet ? includeGauntlet : includeRegular));
  }, [filter, trophies, includeRegular, includeGauntlet, regularToGauntlet]);

  const filteredEhog = useMemo(() => {
    const base = filter === 'career'
      ? ehogHistory
      : (() => {
          const sel = regularSeasons.find((s) => s.id === filter);
          const sn = sel ? extractSeasonNumber(sel.name) : null;
          return ehogHistory.filter((h) => h.seasonNumber === sn);
        })();
    return base.filter((h) =>
      h.isGauntlet ? includeGauntlet : includeRegular,
    );
  }, [filter, ehogHistory, includeRegular, includeGauntlet, regularSeasons]);

  const agg = aggregate(filtered);
  const peakEhog = useMemo(() => {
    if (filteredEhog.length === 0) return null;
    return Math.max(...filteredEhog.map((h) => h.ehogRating));
  }, [filteredEhog]);
  const maps = aggregateByMap(filtered);
  const playerMapStats = aggregatePlayerMapStats(filtered);
  const playerSideStats = aggregatePlayerSideStats(filtered);
  const playedHistory = filtered.filter(isPlayed);
  const upcomingHistory = filtered.filter((r) => !isPlayed(r)).reverse();
  useEffect(() => {
    if (upcomingHistory.length === 0) setMatchesSubTab('history');
  }, [upcomingHistory.length]);

  // Chronological ADR series (history is sorted newest-first; reverse for the sparkline).
  const adrSeries = useMemo(
    () => playedHistory.slice().reverse().map((r) => r.adr),
    [playedHistory],
  );

  const percentiles = useMemo(() => {
    const adrAll = careerLeaderboard.map((r) => r.overall_adr);
    const kdAll = careerLeaderboard.map((r) => r.kd_ratio);
    const wrAll = careerLeaderboard.map((r) => r.win_rate_percentage);
    return {
      adr: percentileOf(agg.adr, adrAll),
      kd: percentileOf(agg.kd, kdAll),
      wr: percentileOf(agg.wr, wrAll),
    };
  }, [careerLeaderboard, agg]);

  const isCareer = filter === 'career';

  const medalCounts = useMemo(() => {
    const counts: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
    for (const t of filteredTrophies) counts[t.rank]++;
    return counts;
  }, [filteredTrophies]);

  const playerTabs: { key: PlayerTab; label: string }[] = [
    { key: 'stats', label: 'Overview' },
    { key: 'matches', label: `Matches${playedHistory.length > 0 ? ` (${playedHistory.length})` : ''}` },
    { key: 'matchups', label: 'H2H' },
  ];
  if (trophies.length > 0) {
    playerTabs.push({ key: 'trophies', label: `Trophy Case${filteredTrophies.length > 0 ? ` (${filteredTrophies.length})` : ''}` });
  }

  return (
    <>
      {/* Trophy summary — above Last 5 */}
      {trophies.length > 0 && (
        <button
          onClick={() => setTab('trophies')}
          className="mb-3 flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Trophies</span>
          <div className="flex items-center gap-3 font-mono text-[12px]">
            {([1, 2, 3] as const).map((rank) => (
              <span key={rank} className="flex items-center gap-1" style={{ color: MEDAL_COLORS[rank] }}>
                <span>{MEDAL_ICONS[rank]}</span>
                <span className="font-semibold">{medalCounts[rank]}</span>
              </span>
            ))}
          </div>
        </button>
      )}

      {/* Last 5 — above tabs */}
      <div className="mb-4 flex items-center gap-3">
        <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Last 5</span>
        <div className="flex items-center gap-2">
          {last5.length === 0 ? (
            <span className="text-[12px] text-[var(--color-text-secondary)]">No recent matches</span>
          ) : (
            last5.map((r, i) => (
              <span key={r.id ?? i} className={`wl-chip wl-chip--sm ${r.is_win ? 'wl-chip--win' : 'wl-chip--loss'}`} aria-label={r.is_win ? 'Win' : 'Loss'}>
                {r.is_win ? 'W' : 'L'}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Next Match — below Last 5 */}
      {upcomingHistory.length > 0 && (() => {
        const next = upcomingHistory[0];
        const opponents = next.faction === 'SHIRTS'
          ? next.skins.map((p) => p.player_name).join(' & ') || 'TBD'
          : next.shirts.map((p) => p.player_name).join(' & ') || 'TBD';
        return (
          <Link
            href={`/matches/${next.match_id}`}
            className="mb-4 inline-flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <span className="tracked text-[10px] text-[var(--color-text-secondary)] shrink-0">Next Match</span>
            <div className="flex items-center gap-2 font-mono text-[12px] min-w-0">
              {next.map && (
                <span className="font-semibold text-[var(--color-text-primary)] truncate">{next.map}</span>
              )}
              <span className="text-[var(--color-text-secondary)] shrink-0">vs</span>
              <span className="text-[var(--color-text-primary)] truncate">{opponents}</span>
              {next.scheduled_at && (
                <CountdownTimer iso={next.scheduled_at} className="tracked text-[9px] text-[var(--color-text-secondary)]" />
              )}
            </div>
          </Link>
        );
      })()}

      {/* Tab bar + filter controls */}
      <div className="flex flex-wrap items-center gap-y-2 border-b border-[var(--color-border-primary)] mb-6">
        {playerTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={tabCls(tab === t.key)}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-4 pb-0.5">
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
      </div>

      {/* Stats tab */}
      {tab === 'stats' && (
        <>
          <div className="flex items-baseline justify-between mb-3">
            <span className="tracked text-[10px] text-[var(--color-text-secondary)]">
              {isCareer ? 'Career' : 'Season'} stats
            </span>
            <Link
              href="/statistics"
              className="tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              View all →
            </Link>
          </div>
          <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
            <div className="grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-10">
              <StatCell v={agg.matches} l="Games" />
              <StatCell v={`${agg.wins}-${agg.losses}`} l="W-L" />
              <StatCell v={`${agg.wr.toFixed(1)}%`} l="Win rate" />
              <StatCell v={`${agg.rwr.toFixed(1)}%`} l="RWR%" />
              <StatCell v={agg.kills} l="Kills" />
              <StatCell v={agg.assists} l="Assists" />
              <StatCell v={agg.deaths} l="Deaths" />
              <StatCell v={agg.kd.toFixed(2)} l="K/D" />
              <StatCell v={agg.adr.toFixed(2)} l="ADR" />
              {peakEhog !== null && <StatCell v={peakEhog.toFixed(2)} l="Peak EHOG" />}
            </div>
          </div>

          {isCareer && activeSeasons.length > 0 && (
            <>
              <SectionLabel>Season history</SectionLabel>
              <LeaderboardTable
                firstColMode="season"
                rows={activeSeasons.map((s): LeaderboardRowWithId => {
                  const pairedGntId = regularToGauntlet.get(s.id);
                  const seasonRows = history.filter((r) => {
                    if (r.season_id === s.id) return r.is_gauntlet ? includeGauntlet : includeRegular;
                    if (pairedGntId != null && r.season_id === pairedGntId) return includeGauntlet;
                    return false;
                  });
                  const a = aggregate(seasonRows);
                  return {
                    season_id: s.id,
                    player_id: s.id,
                    player_name: seasonTitle(s.name),
                    matches_played: a.matches,
                    matches_won: a.wins,
                    matches_lost: a.losses,
                    win_rate_percentage: a.wr,
                    total_kills: a.kills,
                    total_assists: a.assists,
                    total_deaths: a.deaths,
                    kd_ratio: a.kd,
                    total_damage: a.damage,
                    total_rounds_played: a.rounds_played,
                    total_rounds_won: a.rounds_won,
                    rwr_percentage: a.rwr,
                    overall_adr: a.adr,
                    kills_in_wins: a.kills_in_wins,
                    deaths_in_wins: a.deaths_in_wins,
                    kills_in_losses: a.kills_in_losses,
                    deaths_in_losses: a.deaths_in_losses,
                  };
                })}
              />
            </>
          )}

          {filteredEhog.length > 1 && (
            <div className="mt-8">
              <div className="flex items-baseline justify-between mb-3">
                <span className="tracked text-[10px] text-[var(--color-text-secondary)]">EHOG timeline</span>
                <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">{filteredEhog.length} matches</span>
              </div>
              <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-2 py-3">
                <EhogTimeline history={filteredEhog} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            {/* Pick/Ban Stats */}
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Pick/ban stats</span>
              </div>
              {playerMapStats.length === 0 ? (
                <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
                  No map data.
                </div>
              ) : (
                <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] overflow-hidden">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="bg-[var(--color-bg-secondary)]">
                        <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-left text-[var(--color-text-secondary)]">Map</th>
                        <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">Games</th>
                        <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">Picked</th>
                        <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">W</th>
                        <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">CT</th>
                        <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">T</th>
                      </tr>
                    </thead>
                    <tbody>
                      {playerMapStats.map((m) => (
                        <tr key={m.map} className="lift-row border-b border-[var(--color-border-tertiary)] last:border-b-0">
                          <td className="pl-4 pr-3 py-2.5 tracked text-[11px] font-semibold"><Link href={`/maps/${mapSlug(m.map)}`} className="hover:text-[var(--color-text-secondary)] transition-colors">{m.map}</Link></td>
                          <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{m.games}</td>
                          <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{m.picked}</td>
                          <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{m.pickedAndWon}</td>
                          <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{m.ctPlayed}</td>
                          <td className="px-3 pr-4 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{m.tPlayed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Side Stats */}
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Side stats</span>
              </div>
              {playerSideStats.every((s) => s.played === 0) ? (
                <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
                  No side data.
                </div>
              ) : (
                <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] overflow-hidden">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="bg-[var(--color-bg-secondary)]">
                        <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-left text-[var(--color-text-secondary)]">Side</th>
                        <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">Played</th>
                        <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">Times Picked</th>
                        <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">W-L</th>
                        <th className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">RWR%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {playerSideStats.map((s) => (
                        <tr key={s.side} className="lift-row border-b border-[var(--color-border-tertiary)] last:border-b-0">
                          <td className="pl-4 pr-3 py-2.5 tracked text-[11px] font-semibold">{s.side}</td>
                          <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{s.played}</td>
                          <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{s.numTimesPicked}</td>
                          <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{s.wins}-{s.losses}</td>
                          <td className="px-3 pr-4 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{s.roundsPlayed > 0 ? `${(s.roundsWon / s.roundsPlayed * 100).toFixed(1)}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <SectionLabel>Map stats</SectionLabel>
          {maps.length === 0 ? (
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
              No map data.
            </div>
          ) : (
            <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] overflow-hidden">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-[var(--color-bg-secondary)]">
                    <SortableTh label="Map" colKey="map"    activeCol={mapSort} asc={mapAsc} align="left" onClick={clickMapSort} />
                    <SortableTh label="W-L" colKey="record" activeCol={mapSort} asc={mapAsc} onClick={clickMapSort} />
                    <SortableTh label="WR%" colKey="wr"     activeCol={mapSort} asc={mapAsc} onClick={clickMapSort} />
                    <SortableTh label="RWR%" colKey="rwr"   activeCol={mapSort} asc={mapAsc} onClick={clickMapSort} />
                    <SortableTh label="ADR" colKey="adr"    activeCol={mapSort} asc={mapAsc} onClick={clickMapSort} />
                  </tr>
                </thead>
                <tbody>
                  {[...maps]
                    .sort((a, b) => {
                      let v = 0;
                      switch (mapSort) {
                        case 'map':    v = a.map.localeCompare(b.map); break;
                        case 'record': v = b.wins - a.wins || a.losses - b.losses; break;
                        case 'wr':     v = b.wr - a.wr; break;
                        case 'rwr':    v = b.rwr - a.rwr; break;
                        case 'adr':    v = b.adr - a.adr; break;
                      }
                      return mapAsc ? -v : v;
                    })
                    .map((m) => (
                      <tr key={m.map} className="lift-row border-b border-[var(--color-border-tertiary)] last:border-b-0">
                        <td className="pl-4 pr-3 py-2.5 tracked text-[11px] font-semibold"><Link href={`/maps/${mapSlug(m.map)}`} className="hover:text-[var(--color-text-secondary)] transition-colors">{m.map}</Link></td>
                        <td className="px-3 py-2.5 text-right font-mono tnum">{m.wins}-{m.losses}</td>
                        <td className="px-3 py-2.5 text-right font-mono tnum">
                          {m.wr.toFixed(1)}%
                          <span className="inline-block w-[60px] h-[4px] bg-[var(--color-bg-secondary)] ml-2 align-middle">
                            <span className="block h-full bg-[var(--color-accent-green-fill)]" style={{ width: `${Math.max(0, Math.min(100, m.wr))}%` }} />
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tnum">{m.rwr.toFixed(1)}%</td>
                        <td className="px-3 pr-4 py-2.5 text-right font-mono tnum font-semibold">{m.adr.toFixed(2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {adrSeries.length > 1 && (
          <DevGate className="mt-10">
              <div className="flex items-baseline justify-between mb-3">
                <span className="tracked text-[10px] text-[var(--color-text-secondary)]">ADR over time</span>
                <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">{adrSeries.length} matches</span>
              </div>
              <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-3 text-[var(--color-site-accent)]">
                <Sparkline
                  data={adrSeries}
                  width={420}
                  height={62}
                  color="currentColor"
                  fill="color-mix(in srgb, currentColor 16%, transparent)"
                  strokeWidth={2.5}
                  showDot
                />
              </div>
          </DevGate>
          )}

          <DevGate className="mt-10">
              <div className="flex items-baseline justify-between mb-3">
                <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Percentile vs league</span>
                <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">median = midline</span>
              </div>
              <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-2">
                <PctRow label="ADR" pct={percentiles.adr} value={agg.adr.toFixed(1)} />
                <PctRow label="K/D" pct={percentiles.kd} value={agg.kd.toFixed(2)} />
                <PctRow label="Win rate" pct={percentiles.wr} value={`${agg.wr.toFixed(0)}%`} />
              </div>
          </DevGate>
        </>
      )}

      {/* Matches tab */}
      {tab === 'matches' && (
        <>
          {upcomingHistory.length > 0 && (
            <div className="flex items-center gap-0 border-b border-[var(--color-border-primary)] mb-6">
              <button onClick={() => setMatchesSubTab('history')} className={tabCls(matchesSubTab === 'history')}>
                History
              </button>
              <button onClick={() => setMatchesSubTab('upcoming')} className={tabCls(matchesSubTab === 'upcoming')}>
                Upcoming ({upcomingHistory.length})
              </button>
            </div>
          )}

          {matchesSubTab === 'upcoming' && upcomingHistory.length > 0 ? (
            <div className="flex flex-col gap-3">
              {upcomingHistory.map((h) => (
                <MatchCard
                  key={h.id}
                  href={`/matches/${h.match_id}`}
                  map={h.map}
                  label={{ type: 'player-history', seasonNumber: h.season_number, isGauntlet: h.is_gauntlet, weekNumber: h.week_number, matchNumber: h.match_number }}
                  right={{ type: 'pending' }}
                  shirtsStats={h.shirts_stats}
                  skinsStats={h.skins_stats}
                  shirtsFallback={h.shirts.map((p) => p.player_name).join(' & ') || 'Shirts TBD'}
                  skinsFallback={h.skins.map((p) => p.player_name).join(' & ') || 'Skins TBD'}
                  currentPlayerId={h.player_id}
                  highlightCurrentPlayer
                  containerVariant="standalone"
                />
              ))}
            </div>
          ) : (
            <>
              {playedHistory.length === 0 ? (
                <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
                  No matches played yet.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {playedHistory.map((h) => (
                    <MatchCard
                      key={h.id}
                      href={`/matches/${h.match_id}`}
                      map={h.map}
                      label={{ type: 'player-history', seasonNumber: h.season_number, isGauntlet: h.is_gauntlet, weekNumber: h.week_number, matchNumber: h.match_number }}
                      outcome={h.is_win ? 'win' : 'loss'}
                      right={{ type: 'score', score: h.final_score! }}
                      shirtsStats={h.shirts_stats}
                      skinsStats={h.skins_stats}
                      shirtsFallback={h.shirts.map((p) => p.player_name).join(' & ') || 'Shirts TBD'}
                      skinsFallback={h.skins.map((p) => p.player_name).join(' & ') || 'Skins TBD'}
                      currentPlayerId={h.player_id}
                      highlightCurrentPlayer
                      containerVariant="standalone"
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Matchups tab */}
      {tab === 'matchups' && (
        <MatchupsTab playerId={playerId} h2hData={h2hData} />
      )}

      {/* Trophy Case tab */}
      {tab === 'trophies' && (
        <>
          <SectionLabel>Trophy case</SectionLabel>
          {filteredTrophies.length === 0 ? (
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
              No trophies for the current filter.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredTrophies
                .slice()
                .sort((a, b) => a.rank - b.rank || b.season_id - a.season_id)
                .map((t) => {
                  const seasonType = t.is_gauntlet ? 'Gauntlet' : 'Regular Season';
                  const placement = (t.is_gauntlet ? GAUNTLET_PLACEMENTS : REGULAR_PLACEMENTS)[t.rank];
                  return (
                    <Link
                      key={`${t.season_id}-${t.rank}`}
                      href={`/seasons/${t.season_id}`}
                      className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:opacity-90"
                      style={{
                        background: `color-mix(in srgb, ${MEDAL_COLORS[t.rank]} 12%, var(--color-bg-primary))`,
                        border: `2px solid ${MEDAL_COLORS[t.rank]}`,
                      }}
                    >
                      <div className="flex items-center gap-4">
                        <span className="text-[24px] leading-none">{MEDAL_ICONS[t.rank]}</span>
                        <div>
                          <div className="font-display text-[16px] font-semibold leading-tight">
                            {seasonTitle(t.season_name)}
                          </div>
                          <div className="tracked text-[9px]" style={{ color: MEDAL_COLORS[t.rank] }}>
                            {seasonType} · {placement}
                          </div>
                        </div>
                      </div>
                      <table className="border-collapse table-fixed text-[11px] shrink-0">
                        <thead>
                          <tr>
                            <th className="w-9 tracked text-[9px] font-semibold text-[var(--color-text-secondary)] text-right pr-3 pb-1">K</th>
                            <th className="w-9 tracked text-[9px] font-semibold text-[var(--color-text-secondary)] text-right pr-3 pb-1">A</th>
                            <th className="w-9 tracked text-[9px] font-semibold text-[var(--color-text-secondary)] text-right pr-3 pb-1">D</th>
                            <th className="w-12 tracked text-[9px] font-semibold text-[var(--color-text-secondary)] text-right pr-3 pb-1">WR%</th>
                            <th className="w-14 tracked text-[9px] font-semibold text-[var(--color-text-secondary)] text-right pr-3 pb-1">Rounds</th>
                            <th className="w-12 tracked text-[9px] font-semibold text-[var(--color-text-secondary)] text-right pb-1">ADR</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="font-mono tnum font-semibold text-right pr-3">{t.stats.kills}</td>
                            <td className="font-mono tnum font-semibold text-right pr-3">{t.stats.assists}</td>
                            <td className="font-mono tnum font-semibold text-right pr-3">{t.stats.deaths}</td>
                            <td className="font-mono tnum font-semibold text-right pr-3">{t.stats.win_rate_percentage.toFixed(1)}%</td>
                            <td className="font-mono tnum font-semibold text-right pr-3">{t.stats.rounds_won}-{t.stats.rounds_lost}</td>
                            <td className="font-mono tnum font-semibold text-right">{t.stats.overall_adr.toFixed(2)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </Link>
                  );
                })}
            </div>
          )}
        </>
      )}
    </>
  );
}
