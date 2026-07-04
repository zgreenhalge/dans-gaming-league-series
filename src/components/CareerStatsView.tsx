'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import LeaderboardTable from './LeaderboardTable';
import { useSeasonFilter, SeasonFilter } from './SeasonFilter';
import H2HSection from './H2HSection';
import { BasicStatsView } from './BasicStatsView';
import { buildRegularToGauntletMap, computeH2H, deriveRates, extractSeasonNumber, mapMatchRowsToH2HInput, seasonTitle, tabCls } from '@/lib/util';
import type { LeaderboardRowWithId } from '@/lib/types';
import type { TrophyEntry, MapMatchRow, EhogSnapshotRow, SabremetricMatchRow } from '@/lib/queries';
import type { H2HPair } from './H2HMatrix';
import EhogTierBar from './EhogTierBar';
import SabremetricsLeaderboardView from './SabremetricsLeaderboardView';
import TabBar from './TabBar';

type Filter = 'career' | number;
type Tab = 'leaderboard' | 'stats' | 'advanced' | 'h2h';

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
    const totals = {
      matches_played: prev.matches_played + row.matches_played,
      matches_won: prev.matches_won + row.matches_won,
      matches_lost: prev.matches_lost + row.matches_lost,
      total_kills: prev.total_kills + row.total_kills,
      total_assists: prev.total_assists + row.total_assists,
      total_deaths: prev.total_deaths + row.total_deaths,
      total_damage: prev.total_damage + row.total_damage,
      total_rounds_played: prev.total_rounds_played + row.total_rounds_played,
      total_rounds_won: prev.total_rounds_won + row.total_rounds_won,
    };
    map.set(row.player_id, {
      ...prev,
      season_id: -1,
      ...totals,
      ...deriveRates(totals),
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
  players,
  allMatches = [],
  ehogSnapshots = [],
  allSabremetrics = [],
}: {
  regularSeasons: { id: number; name: string }[];
  gauntletSeasons: { id: number; name: string }[];
  careerRows: LeaderboardRowWithId[];
  bySeason: Record<number, LeaderboardRowWithId[]>;
  gauntletCareerRows: LeaderboardRowWithId[];
  gauntletBySeason: Record<number, LeaderboardRowWithId[]>;
  trophiesByPlayer: Record<number, TrophyEntry[]>;
  players: { id: number; name: string; steam_avatar_url: string | null }[];
  allMatches?: MapMatchRow[];
  ehogSnapshots?: EhogSnapshotRow[];
  allSabremetrics?: SabremetricMatchRow[];
}) {
  const searchParams = useSearchParams();
  const { includeRegular, includeGauntlet, toggleRegular: baseToggleRegular, toggleGauntlet: baseToggleGauntlet } = useSeasonFilter();
  const [filter, setFilter] = useState<Filter>('career');
  const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'h2h' ? 'h2h' : 'leaderboard');
  const [hoveredPlayerId, setHoveredPlayerId] = useState<number | null>(null);

  const urlInitialPair = useMemo<H2HPair | null>(() => {
    const aName = searchParams.get('a');
    const bName = searchParams.get('b');
    const type = searchParams.get('type') === 'opponent' ? 'opponent' : 'partner';
    if (!aName || !bName) return null;
    const a = players.find((p) => p.name.toLowerCase() === aName.toLowerCase());
    const b = players.find((p) => p.name.toLowerCase() === bName.toLowerCase());
    if (!a || !b) return null;
    return { a: a.id, b: b.id, type };
  }, [searchParams, players]);

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

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const h2hData = useMemo(
    () => computeH2H(mapMatchRowsToH2HInput(filteredMatches), playersById),
    [filteredMatches, playersById],
  );

  const filteredSabremetrics = useMemo(() => {
    if (filter === 'career') {
      return allSabremetrics.filter((r) => r.is_gauntlet ? includeGauntlet : includeRegular);
    }
    const pairedGntId = regularToGauntlet.get(filter);
    return allSabremetrics.filter((r) => {
      if (r.season_id === filter) return r.is_gauntlet ? includeGauntlet : includeRegular;
      if (pairedGntId != null && r.season_id === pairedGntId) return includeGauntlet;
      return false;
    });
  }, [filter, allSabremetrics, includeRegular, includeGauntlet, regularToGauntlet]);

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
      <TabBar
        bordered
        className="mb-3"
        controls={
          (tab === 'leaderboard' || tab === 'stats' || tab === 'advanced' || tab === 'h2h') ? (
            <>
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
            </>
          ) : undefined
        }
      >
        <button className={tabCls(tab === 'leaderboard')} onClick={() => setTab('leaderboard')}>
          Leaderboard
        </button>
        <button className={tabCls(tab === 'stats')} onClick={() => setTab('stats')}>
          Stats
        </button>
        <button className={tabCls(tab === 'advanced')} onClick={() => setTab('advanced')}>
          Advanced Stats
        </button>
        <button className={tabCls(tab === 'h2h')} onClick={() => setTab('h2h')}>
          H2H
        </button>
      </TabBar>

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
                highlightPlayerId={hoveredPlayerId}
              />
            </div>
            <LeaderboardTable rows={rows} showMedals={false} showRank={false} trophyCounts={trophyCounts} ehogRatings={ehogRatings} onPlayerHover={setHoveredPlayerId} />
          </>
        )
      )}

      {tab === 'stats' && (
        rows.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            No data for this selection.
          </div>
        ) : (
          <BasicStatsView rows={rows} matches={filteredMatches} />
        )
      )}

      {tab === 'advanced' && (
        <SabremetricsLeaderboardView rows={filteredSabremetrics} />
      )}

      {tab === 'h2h' && (
        <H2HSection data={h2hData} initialPair={urlInitialPair} />
      )}
    </>
  );
}

