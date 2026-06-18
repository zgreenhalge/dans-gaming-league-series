'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import LeaderboardTable from './LeaderboardTable';
import { useSeasonFilter, SeasonFilter } from './SeasonFilter';
import H2HSection from './H2HSection';
import { AdvancedStatsView } from './AdvancedStatsView';
import { buildRegularToGauntletMap, extractSeasonNumber, seasonTitle, tabCls } from '@/lib/util';
import type { LeaderboardRowWithId } from '@/lib/types';
import type { TrophyEntry, H2HData, MapMatchRow, EhogSnapshotRow } from '@/lib/queries';
import type { H2HPair } from './H2HMatrix';
import EhogTierBar from './EhogTierBar';

type Filter = 'career' | number;
type Tab = 'leaderboard' | 'stats' | 'h2h';

function mergeRows(
  a: LeaderboardRowWithId[],
  b: LeaderboardRowWithId[],
): LeaderboardRowWithId[] {
  const map = new Map<number, LeaderboardRowWithId>();
  for (const row of [...a, ...b]) {
    const prev = map.get(row.player_id);
    if (!prev) {
      map.set(row.player_id, { ...row });
      continue;
    }
    const mp = prev.matches_played + row.matches_played;
    const mw = prev.matches_won + row.matches_won;
    const ml = prev.matches_lost + row.matches_lost;
    const rp = prev.total_rounds_played + row.total_rounds_played;
    const rw = prev.total_rounds_won + row.total_rounds_won;
    const kills = prev.total_kills + row.total_kills;
    const deaths = prev.total_deaths + row.total_deaths;
    const td = prev.total_damage + row.total_damage;
    map.set(row.player_id, {
      ...prev,
      season_id: -1,
      matches_played: mp,
      matches_won: mw,
      matches_lost: ml,
      total_kills: kills,
      total_assists: prev.total_assists + row.total_assists,
      total_deaths: deaths,
      total_damage: td,
      total_rounds_played: rp,
      total_rounds_won: rw,
      win_rate_percentage: mp > 0 ? (mw / mp) * 100 : 0,
      kd_ratio: deaths > 0 ? kills / deaths : kills,
      rwr_percentage: rp > 0 ? (rw / rp) * 100 : 0,
      overall_adr: rp > 0 ? td / rp : 0,
    });
  }
  return Array.from(map.values());
}

export default function CareerStatsView({
  regularSeasons,
  gauntletSeasons,
  careerRows,
  bySeason,
  gauntletCareerRows,
  gauntletBySeason,
  trophiesByPlayer,
  h2hData,
  allMatches = [],
  ehogSnapshots = [],
}: {
  regularSeasons: { id: number; name: string }[];
  gauntletSeasons: { id: number; name: string }[];
  careerRows: LeaderboardRowWithId[];
  bySeason: Record<number, LeaderboardRowWithId[]>;
  gauntletCareerRows: LeaderboardRowWithId[];
  gauntletBySeason: Record<number, LeaderboardRowWithId[]>;
  trophiesByPlayer: Record<number, TrophyEntry[]>;
  h2hData: H2HData;
  allMatches?: MapMatchRow[];
  ehogSnapshots?: EhogSnapshotRow[];
}) {
  const searchParams = useSearchParams();
  const { includeRegular, includeGauntlet, toggleRegular: baseToggleRegular, toggleGauntlet: baseToggleGauntlet } = useSeasonFilter();
  const [filter, setFilter] = useState<Filter>('career');
  const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'h2h' ? 'h2h' : 'leaderboard');

  const urlInitialPair = useMemo<H2HPair | null>(() => {
    const aName = searchParams.get('a');
    const bName = searchParams.get('b');
    const type = searchParams.get('type') === 'opponent' ? 'opponent' : 'partner';
    if (!aName || !bName) return null;
    const a = h2hData.players.find((p) => p.name.toLowerCase() === aName.toLowerCase());
    const b = h2hData.players.find((p) => p.name.toLowerCase() === bName.toLowerCase());
    if (!a || !b) return null;
    return { a: a.id, b: b.id, type };
  }, [searchParams, h2hData.players]);

  function toggleRegular() { baseToggleRegular(); setFilter('career'); }
  function toggleGauntlet() { baseToggleGauntlet(); setFilter('career'); }

  // Map regular season ID → paired gauntlet season ID (matched by season number)
  const regularToGauntlet = useMemo(
    () => buildRegularToGauntletMap(regularSeasons, gauntletSeasons),
    [regularSeasons, gauntletSeasons],
  );

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

  const rows = useMemo<LeaderboardRowWithId[]>(() => {
    if (filter === 'career') {
      if (includeRegular && includeGauntlet) return mergeRows(careerRows, gauntletCareerRows);
      if (includeRegular) return careerRows;
      return gauntletCareerRows;
    }
    const reg = includeRegular ? (bySeason[filter] ?? []) : [];
    const pairedGntId = regularToGauntlet.get(filter);
    const gnt = includeGauntlet
      ? (pairedGntId ? gauntletBySeason[pairedGntId] : gauntletBySeason[filter]) ?? []
      : [];
    if (reg.length > 0 && gnt.length > 0) return mergeRows(reg, gnt);
    return reg.length > 0 ? reg : gnt;
  }, [filter, includeRegular, includeGauntlet, careerRows, gauntletCareerRows, bySeason, gauntletBySeason, regularToGauntlet]);

  const filteredMatches = useMemo<MapMatchRow[]>(() => {
    if (filter === 'career') {
      return allMatches.filter((m) => m.is_gauntlet ? includeGauntlet : includeRegular);
    }
    const pairedGntId = regularToGauntlet.get(filter);
    return allMatches.filter((m) => {
      if (m.season_id === filter) return m.is_gauntlet ? includeGauntlet : includeRegular;
      if (pairedGntId != null && m.season_id === pairedGntId) return includeGauntlet;
      return false;
    });
  }, [filter, allMatches, includeRegular, includeGauntlet, regularToGauntlet]);

  const trophyCounts = useMemo(() => {
    const counts = new Map<number, Record<1 | 2 | 3, number>>();
    for (const [pidStr, entries] of Object.entries(trophiesByPlayer)) {
      const pairedGntId = filter === 'career' ? null : regularToGauntlet.get(filter);
      const inSelection = filter === 'career'
        ? entries
        : entries.filter((t) => t.season_id === filter || (pairedGntId != null && t.season_id === pairedGntId));
      const matching = inSelection.filter((t) => (t.is_gauntlet ? includeGauntlet : includeRegular));
      const c: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
      for (const t of matching) c[t.rank]++;
      counts.set(Number(pidStr), c);
    }
    return counts;
  }, [trophiesByPlayer, filter, includeRegular, includeGauntlet, regularToGauntlet]);

  const ehogRatings = useMemo<Record<number, number>>(() => {
    const filtered = filter === 'career'
      ? ehogSnapshots.filter((s) => s.isGauntlet ? includeGauntlet : includeRegular)
      : (() => {
          const sel = regularSeasons.find((rs) => rs.id === filter);
          const sn = sel ? extractSeasonNumber(sel.name) : null;
          return ehogSnapshots.filter((s) => s.seasonNumber === sn && (s.isGauntlet ? includeGauntlet : includeRegular));
        })();
    const latest: Record<number, { rating: number; seq: number }> = {};
    for (const s of filtered) {
      const prev = latest[s.playerId];
      if (!prev || s.sequenceIndex > prev.seq) {
        latest[s.playerId] = { rating: s.ehogRating, seq: s.sequenceIndex };
      }
    }
    const result: Record<number, number> = {};
    for (const [pid, val] of Object.entries(latest)) result[Number(pid)] = val.rating;
    return result;
  }, [ehogSnapshots, filter, includeRegular, includeGauntlet, regularSeasons]);

  return (
    <>
      <div className="flex items-center justify-between gap-5 mb-3 border-b border-[var(--color-border-tertiary)]">
        <div className="flex items-center">
          <button className={tabCls(tab === 'leaderboard')} onClick={() => setTab('leaderboard')}>
            Leaderboard
          </button>
          <button className={tabCls(tab === 'stats')} onClick={() => setTab('stats')}>
            Stats
          </button>
          <button className={tabCls(tab === 'h2h')} onClick={() => setTab('h2h')}>
            H2H
          </button>
        </div>
        {(tab === 'leaderboard' || tab === 'stats') && (
          <div className="flex items-center gap-5 pb-3">
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
        )}
      </div>

      {tab === 'leaderboard' && (
        rows.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            No data for this selection.
          </div>
        ) : (
          <>
            <div className="mb-4">
              <EhogTierBar
                players={rows
                  .filter((r) => ehogRatings[r.player_id] != null)
                  .map((r) => ({ id: r.player_id, name: r.player_name, rating: ehogRatings[r.player_id] }))}
              />
            </div>
            <LeaderboardTable rows={rows} showMedals={false} showRank={false} trophyCounts={trophyCounts} ehogRatings={ehogRatings} />
          </>
        )
      )}

      {tab === 'stats' && (
        rows.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            No data for this selection.
          </div>
        ) : (
          <AdvancedStatsView rows={rows} matches={filteredMatches} />
        )
      )}

      {tab === 'h2h' && (
        <H2HSection data={h2hData} initialPair={urlInitialPair} />
      )}
    </>
  );
}

