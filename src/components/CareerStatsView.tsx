'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import EmptyState from './EmptyState';
import LeaderboardTable from './LeaderboardTable';
import { useSeasonFilter, SeasonFilter } from './SeasonFilter';
import { useTabState } from './useTabState';
import { useSetUrlParams } from './useUrlState';
import H2HSection, { parseH2HPairFromParams, h2hPairToParams } from './H2HSection';
import { BasicStatsView } from './BasicStatsView';
import { buildRegularToGauntletMap, deriveRates, extractSeasonNumber, seasonTitle, tabCls } from '@/lib/util';
import { computeH2H, mapMatchRowsToH2HInput } from '@/lib/h2h';
import type { LeaderboardRowWithId } from '@/lib/types';
import type { TrophyEntry, MapMatchRow, EhogSnapshotRow, SabremetricMatchRow } from '@/lib/queries';
import type { H2HPair } from './H2HMatrix';
import EhogTierBar from './EhogTierBar';
import SabremetricsLeaderboardView from './SabremetricsLeaderboardView';
import TabBar from './TabBar';

type Tab = 'leaderboard' | 'stats' | 'advanced' | 'h2h';

const CAREER_TABS: readonly Tab[] = ['leaderboard', 'stats', 'advanced', 'h2h'];

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
  // `resetSeasonOnToggle: true` — matches `PlayerView`'s behavior: toggling regular/gauntlet
  // unconditionally resets the season selector back to "all" (this page's "Career").
  const { includeRegular, includeGauntlet, selectedSeason, toggleRegular, toggleGauntlet, setSelectedSeason } = useSeasonFilter({ resetSeasonOnToggle: true });
  const [tab, setTab] = useTabState(CAREER_TABS, 'leaderboard');
  const [hoveredPlayerId, setHoveredPlayerId] = useState<number | null>(null);

  // A single `useSearchParams()` read for the initial pair (rather than going through `useUrlState`)
  // since the read side alone needs no write plumbing of its own — `setUrlParams` below covers the
  // one atomic write `onPairChange` needs.
  const searchParams = useSearchParams();
  const setUrlParams = useSetUrlParams();

  const urlInitialPair = useMemo<H2HPair | null>(
    () => parseH2HPairFromParams(searchParams, players),
    [searchParams, players],
  );

  function handleH2HPairChange(pair: H2HPair) {
    setUrlParams(h2hPairToParams(pair, players));
  }

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
    if (selectedSeason === 'all') {
      if (includeRegular && includeGauntlet) return mergeRows(careerRows, gauntletCareerRows);
      if (includeRegular) return careerRows;
      return gauntletCareerRows;
    }
    const reg = includeRegular ? (bySeason[selectedSeason] ?? []) : [];
    const pairedGntId = regularToGauntlet.get(selectedSeason);
    const gnt = includeGauntlet
      ? (pairedGntId ? gauntletBySeason[pairedGntId] : gauntletBySeason[selectedSeason]) ?? []
      : [];
    if (reg.length > 0 && gnt.length > 0) return mergeRows(reg, gnt);
    return reg.length > 0 ? reg : gnt;
  }, [selectedSeason, includeRegular, includeGauntlet, careerRows, gauntletCareerRows, bySeason, gauntletBySeason, regularToGauntlet]);

  const filteredMatches = useMemo<MapMatchRow[]>(() => {
    if (selectedSeason === 'all') {
      return allMatches.filter((m) => m.is_gauntlet ? includeGauntlet : includeRegular);
    }
    const pairedGntId = regularToGauntlet.get(selectedSeason);
    return allMatches.filter((m) => {
      if (m.season_id === selectedSeason) return m.is_gauntlet ? includeGauntlet : includeRegular;
      if (pairedGntId != null && m.season_id === pairedGntId) return includeGauntlet;
      return false;
    });
  }, [selectedSeason, allMatches, includeRegular, includeGauntlet, regularToGauntlet]);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const h2hData = useMemo(
    () => computeH2H(mapMatchRowsToH2HInput(filteredMatches), playersById),
    [filteredMatches, playersById],
  );

  const filteredSabremetrics = useMemo(() => {
    if (selectedSeason === 'all') {
      return allSabremetrics.filter((r) => r.is_gauntlet ? includeGauntlet : includeRegular);
    }
    const pairedGntId = regularToGauntlet.get(selectedSeason);
    return allSabremetrics.filter((r) => {
      if (r.season_id === selectedSeason) return r.is_gauntlet ? includeGauntlet : includeRegular;
      if (pairedGntId != null && r.season_id === pairedGntId) return includeGauntlet;
      return false;
    });
  }, [selectedSeason, allSabremetrics, includeRegular, includeGauntlet, regularToGauntlet]);

  const trophyCounts = useMemo(() => {
    const counts = new Map<number, Record<1 | 2 | 3, number>>();
    for (const [pidStr, entries] of Object.entries(trophiesByPlayer)) {
      const pairedGntId = selectedSeason === 'all' ? null : regularToGauntlet.get(selectedSeason);
      const inSelection = selectedSeason === 'all'
        ? entries
        : entries.filter((t) => t.season_id === selectedSeason || (pairedGntId != null && t.season_id === pairedGntId));
      const matching = inSelection.filter((t) => (t.is_gauntlet ? includeGauntlet : includeRegular));
      const c: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
      for (const t of matching) c[t.rank]++;
      counts.set(Number(pidStr), c);
    }
    return counts;
  }, [trophiesByPlayer, selectedSeason, includeRegular, includeGauntlet, regularToGauntlet]);

  const ehogRatings = useMemo<Record<number, number>>(() => {
    const filtered = selectedSeason === 'all'
      ? ehogSnapshots.filter((s) => s.isGauntlet ? includeGauntlet : includeRegular)
      : (() => {
          const sel = regularSeasons.find((rs) => rs.id === selectedSeason);
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
  }, [ehogSnapshots, selectedSeason, includeRegular, includeGauntlet, regularSeasons]);

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
                value={String(selectedSeason)}
                onChange={(e) => {
                  const v = e.target.value;
                  setSelectedSeason(v === 'all' ? 'all' : Number(v));
                }}
                className="tracked text-[11px] font-semibold border border-[var(--color-border-primary)] px-2.5 py-1 bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] cursor-pointer hover:bg-[var(--color-bg-secondary)] transition-colors"
              >
                <option value="all">Career</option>
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
        <button role="tab" aria-selected={tab === 'leaderboard'} className={tabCls(tab === 'leaderboard')} onClick={() => setTab('leaderboard')}>
          Leaderboard
        </button>
        <button role="tab" aria-selected={tab === 'stats'} className={tabCls(tab === 'stats')} onClick={() => setTab('stats')}>
          Stats
        </button>
        <button role="tab" aria-selected={tab === 'advanced'} className={tabCls(tab === 'advanced')} onClick={() => setTab('advanced')}>
          Advanced Stats
        </button>
        <button role="tab" aria-selected={tab === 'h2h'} className={tabCls(tab === 'h2h')} onClick={() => setTab('h2h')}>
          H2H
        </button>
      </TabBar>

      {tab === 'leaderboard' && (
        rows.length === 0 ? (
          <EmptyState message="No data for this selection." />
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
          <EmptyState message="No data for this selection." />
        ) : (
          <BasicStatsView rows={rows} matches={filteredMatches} />
        )
      )}

      {tab === 'advanced' && (
        <SabremetricsLeaderboardView rows={filteredSabremetrics} />
      )}

      {tab === 'h2h' && (
        <H2HSection data={h2hData} initialPair={urlInitialPair} onPairChange={handleH2HPairChange} />
      )}
    </>
  );
}

