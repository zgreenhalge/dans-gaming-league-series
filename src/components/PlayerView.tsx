'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { PlayerHistoryRow } from '@/lib/queries';
import type { LeaderboardRowWithId } from '@/lib/types';
import { isPlayedScore } from '@/lib/util';
import { mapImageFor } from '@/lib/maps';
import LeaderboardTable from './LeaderboardTable';

type Filter = 'career' | number;
type MapSortCol = 'map' | 'record' | 'wr' | 'adr';

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
  };
}

interface MapAgg {
  map: string;
  wins: number;
  losses: number;
  wr: number;
  adr: number;
}

function aggregateByMap(rows: PlayerHistoryRow[]): MapAgg[] {
  const buckets = new Map<string, PlayerHistoryRow[]>();
  for (const r of rows) {
    if (!r.map) continue;
    const list = buckets.get(r.map) ?? [];
    list.push(r);
    buckets.set(r.map, list);
  }
  const out: MapAgg[] = [];
  for (const [map, list] of buckets) {
    const a = aggregate(list);
    out.push({ map, wins: a.wins, losses: a.losses, wr: a.wr, adr: a.adr });
  }
  return out.sort((a, b) => b.wr - a.wr || b.adr - a.adr);
}

function PlayerMatchRow({
  row,
  variant,
}: {
  row: PlayerHistoryRow;
  variant: 'played' | 'upcoming';
}) {
  const shirts = row.shirts.map((p) => p.player_name).join(' & ') || 'TBD';
  const skins = row.skins.map((p) => p.player_name).join(' & ') || 'TBD';
  const mapImg = mapImageFor(row.map);

  const wlChip =
    variant === 'played' ? (
      <span className={`inline-flex items-center px-2 py-1 tracked text-[14px] lg:text-[15px] font-semibold rounded-md ${row.is_win ? 'text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border border-[var(--color-accent-green-border)]' : 'text-[var(--color-accent-red-fg)] bg-[var(--color-bg-secondary)] border border-[var(--color-border-tertiary)]'}`}>
        {row.is_win ? 'W' : 'L'}
      </span>
    ) : (
      <span className="inline-flex items-center px-2 py-1 tracked text-[14px] lg:text-[15px] font-semibold rounded-md text-[var(--color-accent-amber-fg)] bg-[var(--color-accent-amber-bg)] border border-[var(--color-accent-amber-border)]">
        Pending
      </span>
    );

  return (
    <Link
      href={`/matches/${row.match_id}`}
      className={`block border-b border-[var(--color-border-tertiary)] last:border-b-0 transition-colors ${mapImg ? 'map-card-bg' : 'hover:bg-[var(--color-bg-secondary)]'}`}
      style={mapImg ? ({ ['--map-img' as string]: `url("${mapImg}")` } as React.CSSProperties) : undefined}
    >
      <div className={mapImg ? 'bg-[var(--overlay-strong)] hover:bg-[var(--overlay-medium)] transition-colors' : ''}>
        <div className="px-4 py-2 flex items-center justify-between gap-4 border-b border-[var(--color-border-tertiary)]">
          <div className="flex items-baseline gap-3">
            {wlChip}
            {row.map && (
              <span className="font-display text-[16px] font-semibold text-[var(--color-text-primary)] map-head">
                {row.map}
              </span>
            )}
            <span className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)] map-head">
              Season {row.season_id} · Week {row.week_number} · Match {row.match_number}
            </span>
          </div>
        </div>

        <div className="px-4 py-3">
          {(row as any).shirts_stats && (row as any).shirts_stats.length > 0 ? (
            <div className="grid grid-cols-2 divide-x divide-[var(--color-border-tertiary)]">
              <div className="px-3 py-2">
                <table className="w-full border-collapse">
                  <tbody>
                    {(row as any).shirts_stats.map((p: any) => (
                      <tr key={p.player_id} className={`bg-[var(--overlay-medium)] ${p.player_id === row.player_id ? 'current-player-row' : ''}`}>
                        <td className="pl-2 pr-3 py-0.5 whitespace-nowrap">
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-semibold ${p.is_win ? 'text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)]' : 'text-[var(--color-accent-red-fg)] bg-[var(--color-bg-secondary)]'}`}>
                            {p.is_win ? 'W' : 'L'}
                          </span>
                        </td>
                        <td className={`font-display ${p.player_id === row.player_id ? 'text-[15px] lg:text-[16px] font-bold' : 'text-[13px] font-semibold'} pl-2 pr-3 py-0.5 whitespace-nowrap`}>
                          {p.player_name}
                        </td>
                        <td className={`font-mono ${p.player_id === row.player_id ? 'text-[12px] font-semibold' : 'text-[11px]'} tnum text-right pr-3 py-0.5 text-[var(--color-text-primary)]`}>
                          {p.kills}/{p.assists}/{p.deaths}
                        </td>
                        <td className={`font-mono ${p.player_id === row.player_id ? 'text-[12px] font-semibold' : 'text-[11px]'} tnum text-right pr-2 py-0.5 text-[var(--color-text-secondary)] whitespace-nowrap`}>
                          {p.adr} ADR
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-3 py-2">
                <table className="w-full border-collapse">
                  <tbody>
                    {(row as any).skins_stats.map((p: any) => (
                      <tr key={p.player_id} className={`bg-[var(--overlay-medium)] ${p.player_id === row.player_id ? 'current-player-row' : ''}`}>
                        <td className="pl-2 pr-3 py-0.5 whitespace-nowrap">
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-semibold ${p.is_win ? 'text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)]' : 'text-[var(--color-accent-red-fg)] bg-[var(--color-bg-secondary)]'}`}>
                            {p.is_win ? 'W' : 'L'}
                          </span>
                        </td>
                        <td className={`font-display ${p.player_id === row.player_id ? 'text-[15px] lg:text-[16px] font-bold' : 'text-[13px] font-semibold'} pl-2 pr-3 py-0.5 whitespace-nowrap`}>
                          {p.player_name}
                        </td>
                        <td className={`font-mono ${p.player_id === row.player_id ? 'text-[12px] font-semibold' : 'text-[11px]'} tnum text-right pr-3 py-0.5 text-[var(--color-text-primary)]`}>
                          {p.kills}/{p.assists}/{p.deaths}
                        </td>
                        <td className={`font-mono ${p.player_id === row.player_id ? 'text-[12px] font-semibold' : 'text-[11px]'} tnum text-right pr-2 py-0.5 text-[var(--color-text-secondary)] whitespace-nowrap`}>
                          {p.adr} ADR
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="font-mono text-[11px] text-[var(--color-text-secondary)] truncate map-head">
              {shirts} <span className="opacity-50 map-head">vs</span> {skins}
            </div>
          )}

          {variant === 'played' && (
            <div className="mt-3 font-mono text-[13px] font-semibold tnum text-[var(--color-text-primary)]">
              {row.kills}<span className="text-[var(--color-text-secondary)] font-normal mx-0.5">/</span>{row.assists}<span className="text-[var(--color-text-secondary)] font-normal mx-0.5">/</span>{row.deaths}
            </div>
          )}
        </div>
      </div>
    </Link>
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
      role="button" tabIndex={0}
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
  history,
}: {
  history: PlayerHistoryRow[];
}) {
  const seasons = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of history) map.set(r.season_id, r.season_name);
    return Array.from(map, ([id, name]) => ({ id, name })).sort(
      (a, b) => a.id - b.id,
    );
  }, [history]);

  const [filter, setFilter] = useState<Filter>('career');
  const [mapSort, setMapSort] = useState<MapSortCol>('wr');
  const [mapAsc, setMapAsc] = useState(false);

  function clickMapSort(col: string) {
    const c = col as MapSortCol;
    if (c === mapSort) setMapAsc(!mapAsc);
    else { setMapSort(c); setMapAsc(c === 'map'); }
  }

  const filtered = useMemo(
    () =>
      filter === 'career'
        ? history
        : history.filter((r) => r.season_id === filter),
    [filter, history],
  );

  const agg = aggregate(filtered);
  const maps = aggregateByMap(filtered);
  const playedHistory = filtered.filter(isPlayed);
  const upcomingHistory = filtered.filter((r) => !isPlayed(r));

  const isCareer = filter === 'career';

  return (
    <>
      <div className="flex items-center justify-end mb-3">
        <select
          value={String(filter)}
          onChange={(e) => {
            const v = e.target.value;
            setFilter(v === 'career' ? 'career' : Number(v));
          }}
          className="tracked text-[11px] font-semibold border border-[var(--color-border-primary)] px-2.5 py-1 bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] cursor-pointer hover:bg-[var(--color-bg-secondary)] transition-colors"
        >
          <option value="career">Career</option>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-baseline justify-between mt-6 mb-3">
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
        <div className="grid grid-cols-4 sm:grid-cols-7">
          <StatCell v={`${agg.wins}-${agg.losses}`} l="W-L" />
          <StatCell v={`${agg.wr.toFixed(1)}%`} l="Win rate" />
          <StatCell v={agg.kills} l="Kills" />
          <StatCell v={agg.assists} l="Assists" />
          <StatCell v={agg.deaths} l="Deaths" />
          <StatCell v={agg.kd.toFixed(2)} l="K/D" />
          <StatCell v={agg.adr.toFixed(1)} l="ADR" />
        </div>
      </div>

      {isCareer && seasons.length > 0 && (
        <>
          <SectionLabel>Season history</SectionLabel>
          <LeaderboardTable
            firstColMode="season"
            rows={seasons.map((s): LeaderboardRowWithId => {
              const a = aggregate(history.filter((r) => r.season_id === s.id));
              const rounds_lost = a.rounds_played - a.rounds_won;
              return {
                season_id: s.id,
                player_id: s.id,
                player_name: s.name,
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
              };
            })}
          />
        </>
      )}

      {upcomingHistory.length > 0 && (
        <>
          <SectionLabel>Upcoming matches</SectionLabel>
          <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
            {upcomingHistory.map((h) => (
              <PlayerMatchRow key={h.id} row={h} variant="upcoming" />
            ))}
          </div>
        </>
      )}

      <SectionLabel>Map statistics</SectionLabel>
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
                    case 'adr':    v = b.adr - a.adr; break;
                  }
                  return mapAsc ? -v : v;
                })
                .map((m) => (
                  <tr key={m.map} className="border-b border-[var(--color-border-tertiary)] last:border-b-0 hover:bg-[var(--color-bg-secondary)] transition-colors">
                    <td className="pl-4 pr-3 py-2.5 tracked text-[11px] font-semibold">{m.map}</td>
                    <td className="px-3 py-2.5 text-right font-mono tnum">{m.wins}-{m.losses}</td>
                    <td className="px-3 py-2.5 text-right font-mono tnum">
                      {m.wr.toFixed(1)}%
                      <span className="inline-block w-[60px] h-[4px] bg-[var(--color-bg-secondary)] ml-2 align-middle">
                        <span className="block h-full bg-[var(--color-accent-green-fill)]" style={{ width: `${Math.max(0, Math.min(100, m.wr))}%` }} />
                      </span>
                    </td>
                    <td className="px-3 pr-4 py-2.5 text-right font-mono tnum font-semibold">{m.adr.toFixed(1)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <SectionLabel>Match history</SectionLabel>
      {playedHistory.length === 0 ? (
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
          No matches played yet.
        </div>
      ) : (
        <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
          {playedHistory.map((h) => (
            <PlayerMatchRow key={h.id} row={h} variant="played" />
          ))}
        </div>
      )}
    </>
  );
}
