'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { groupRoundsByMatch, isPlayedHistoryRow, lastPlayed, opponentNames, type PlayerHistoryRow, type TrophyEntry, type EhogRatingPoint, type SabremetricMatchRow, type MatchRoundRow, type MatchKillRow, type WeaponClassMatchRow, type EconomyMatchRow } from '@/lib/queries';
import type { LeaderboardRowWithId } from '@/lib/types';
import { useLiveH2HData } from './useLiveH2HData';
import { buildRegularToGauntletMap, dedupeVisibleSeasons, extractSeasonNumber, canonicalSortValues, filterByMatchIds, isPlayedScore, seasonTitle, tabCls } from '@/lib/util';
import { aggregatePlayerStats, aggregatePlayerStatsByMap } from '@/lib/player-stats';
import { aggregatePlayerMapStats, aggregatePlayerSideStats } from '@/lib/mapSideStats';
import DevGate from './DevGate';
import EmptyState from './EmptyState';
import { MatchCard } from './MatchCard';
import LeaderboardTable from './LeaderboardTable';
import { useSeasonFilter, CareerSeasonControls } from './SeasonFilter';
import { useTabState, resolveTab } from './useTabState';
import Sparkline from './Sparkline';
import { NextMatchLink } from './NextMatchLink';
import { WLChip } from './WLChip';
import MatchupsTab from './MatchupsTab';
import PlayerTrailsTab from './PlayerTrailsTab';
import EhogTimeline from './EhogTimeline';
import SabremetricsLeaderboardView from './SabremetricsLeaderboardView';
import StatTileGrid from './StatTileGrid';
import TabBar from './TabBar';
import Th from './Th';
import SortableTh from './SortableTh';
import { CompactTable, CompactTh, CompactTr, CompactTd } from './CompactTable';
import { StatTable, Tr, Td, NameTd, MapCell } from './StatTable';

type MapSortCol = 'map' | 'record' | 'wr' | 'rwr' | 'adr';
type PlayerTab = 'stats' | 'matches' | 'advanced' | 'trophies' | 'matchups' | 'trails';
type MatchesSubTab = 'history' | 'upcoming';

const PLAYER_TABS: readonly PlayerTab[] = ['stats', 'matches', 'advanced', 'trophies', 'matchups', 'trails'];
const MATCHES_SUB_TABS: readonly MatchesSubTab[] = ['history', 'upcoming'];

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

export default function PlayerView({
  playerId,
  history,
  trophies,
  careerLeaderboard,
  players,
  ehogHistory,
  matchDeltas,
  sabremetrics = [],
  matchRounds = [],
  matchKills = [],
  matchWeaponClassStats = [],
  economyStats = [],
}: {
  playerId: number;
  history: PlayerHistoryRow[];
  trophies: TrophyEntry[];
  careerLeaderboard: LeaderboardRowWithId[];
  /** id/name/avatar for every player — the Matchups tab's H2H data is computed client-side from
   *  this player's own (season-filtered) `history`, same pattern as `CareerStatsView`/`MapDetailView`,
   *  so it honors the season filter shown on this page instead of a frozen career-wide snapshot. */
  players: { id: number; name: string; steam_avatar_url: string | null }[];
  ehogHistory: EhogRatingPoint[];
  matchDeltas: Record<number, Record<number, number>>;
  /** League-wide sabremetric rows (all players) — the player's own rows and the
   *  Plus-stat baseline are both derived from these under the active season filter. */
  sabremetrics?: SabremetricMatchRow[];
  /** This player's demo-derived round outcomes (all seasons — filtered client-side alongside
   *  `history`) — feeds the Side stats tab's RWR% with a real per-round split instead of the
   *  whole-match-on-starting-side approximation. */
  matchRounds?: MatchRoundRow[];
  /** This player's demo-derived kills (all seasons — filtered client-side alongside `history`) —
   *  feeds the Weapons section's favorite-weapon/kills-by-weapon breakdown. */
  matchKills?: MatchKillRow[];
  /** `player_match_weapon_stats` rows (all seasons — filtered client-side alongside `history`) —
   *  feeds the Weapons section's per-category accuracy/damage/rounds breakdown (#474). */
  matchWeaponClassStats?: WeaponClassMatchRow[];
  /** League-wide per-economy-tier breakdown rows — filtered down to this player's own (season-
   *  filtered) matches the same way `matchKills` is, and feeds the Economy sub-tab. */
  economyStats?: EconomyMatchRow[];
}) {
  const { data: session } = useSession();
  const loggedInPlayerId = session?.user?.playerId ?? null;

  const playerName = useMemo(() => {
    for (const r of history) {
      const p = [...r.shirts, ...r.skins].find((pp) => pp.player_id === playerId);
      if (p) return p.player_name;
    }
    return '';
  }, [history, playerId]);

  const { regularSeasons, gauntletSeasons, regularToGauntlet } = useMemo(() => {
    const regMap = new Map<number, { id: number; name: string }>();
    const gntMap = new Map<number, { id: number; name: string }>();
    for (const r of history) {
      (r.is_gauntlet ? gntMap : regMap).set(r.season_id, { id: r.season_id, name: r.season_name });
    }
    const reg = Array.from(regMap.values()).sort((a, b) => a.id - b.id);
    const gnt = Array.from(gntMap.values()).sort((a, b) => a.id - b.id);
    return { regularSeasons: reg, gauntletSeasons: gnt, regularToGauntlet: buildRegularToGauntletMap(reg, gnt) };
  }, [history]);

  const { includeRegular, includeGauntlet, selectedSeason, toggleRegular, toggleGauntlet, setSelectedSeason } = useSeasonFilter({ regularSeasons, gauntletSeasons });

  const [rawTab, setTab] = useTabState(PLAYER_TABS, 'stats');
  const [rawMatchesSubTab, setMatchesSubTab] = useTabState(MATCHES_SUB_TABS, 'history', 'msub');
  const [mapSort, setMapSort] = useState<MapSortCol>('record');
  const [mapAsc, setMapAsc] = useState(false);
  const mapSortState = { col: mapSort, asc: mapAsc };

  const activeSeasons = useMemo(
    () => dedupeVisibleSeasons(regularSeasons, gauntletSeasons, includeRegular, includeGauntlet),
    [regularSeasons, gauntletSeasons, includeRegular, includeGauntlet],
  );

  function clickMapSort(col: string) {
    const c = col as MapSortCol;
    if (c === mapSort) setMapAsc(!mapAsc);
    else { setMapSort(c); setMapAsc(c === 'map'); }
  }

  const filtered = useMemo(() => {
    const base = selectedSeason === 'all'
      ? history
      : (() => {
          const pairedGntId = regularToGauntlet.get(selectedSeason);
          return history.filter((r) =>
            r.season_id === selectedSeason ||
            (pairedGntId != null && r.season_id === pairedGntId),
          );
        })();
    return base.filter((r) =>
      r.is_gauntlet ? includeGauntlet : includeRegular,
    );
  }, [selectedSeason, history, includeRegular, includeGauntlet, regularToGauntlet]);

  const last5 = useMemo(() => lastPlayed(filtered, 5), [filtered]);

  const filteredTrophies = useMemo(() => {
    const base = selectedSeason === 'all'
      ? trophies
      : (() => {
          const pairedGntId = regularToGauntlet.get(selectedSeason);
          return trophies.filter((t) =>
            t.season_id === selectedSeason ||
            (pairedGntId != null && t.season_id === pairedGntId),
          );
        })();
    return base.filter((t) => (t.is_gauntlet ? includeGauntlet : includeRegular));
  }, [selectedSeason, trophies, includeRegular, includeGauntlet, regularToGauntlet]);

  const filteredEhog = useMemo(() => {
    const base = selectedSeason === 'all'
      ? ehogHistory
      : (() => {
          const sel = regularSeasons.find((s) => s.id === selectedSeason);
          const sn = sel ? extractSeasonNumber(sel.name) : null;
          return ehogHistory.filter((h) => h.seasonNumber === sn);
        })();
    return base.filter((h) =>
      h.isGauntlet ? includeGauntlet : includeRegular,
    );
  }, [selectedSeason, ehogHistory, includeRegular, includeGauntlet, regularSeasons]);

  const agg = aggregatePlayerStats(filtered);
  const peakEhog = useMemo(() => {
    if (filteredEhog.length === 0) return null;
    return Math.max(...filteredEhog.map((h) => h.ehogRating));
  }, [filteredEhog]);
  const maps = aggregatePlayerStatsByMap(filtered);
  const playerMapStats = aggregatePlayerMapStats(filtered);
  const roundsByMatch = useMemo(() => groupRoundsByMatch(matchRounds), [matchRounds]);
  const playerSideStats = aggregatePlayerSideStats(filtered, roundsByMatch);

  // Passed to SabremetricsLeaderboardView's Weapons sub-tab (Advanced tab) — see kills.ts's
  // aggregateWeaponKillStats()/favoriteWeapon() for how it's turned into per-weapon breakdowns.
  const filteredKills = useMemo(() => filterByMatchIds(matchKills, filtered), [filtered, matchKills]);
  const filteredWeaponClassStats = useMemo(
    () => filterByMatchIds(matchWeaponClassStats, filtered),
    [filtered, matchWeaponClassStats],
  );
  const filteredEconomyStats = useMemo(() => filterByMatchIds(economyStats, filtered), [filtered, economyStats]);
  const playedHistory = useMemo(() => filtered.filter(isPlayedHistoryRow), [filtered]);
  const upcomingHistory = filtered.filter((r) => !isPlayedHistoryRow(r)).reverse();
  const nextMatch = upcomingHistory[0] ?? null;

  const h2hData = useLiveH2HData(playedHistory, players);
  // Falls back to "history" when the URL says "upcoming" but there's nothing upcoming under the
  // current season filter (e.g. an old link, or the filter just changed) — a derived read, not a
  // written-back correction, so toggling the filter back and forth doesn't lose an explicit
  // "upcoming" choice the way an imperative reset would.
  const matchesSubTab = rawMatchesSubTab === 'upcoming' && upcomingHistory.length === 0 ? 'history' : rawMatchesSubTab;

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

  const isCareer = selectedSeason === 'all';

  const medalCounts = useMemo(() => {
    const counts: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
    for (const t of filteredTrophies) counts[t.rank]++;
    return counts;
  }, [filteredTrophies]);

  // League-wide sabremetric rows under the active season filter — used as the
  // baseline for the player's Plus stats (player per-round value vs. league avg).
  const filteredLeagueSabremetrics = useMemo(() => {
    const base = selectedSeason === 'all'
      ? sabremetrics
      : (() => {
          const pairedGntId = regularToGauntlet.get(selectedSeason);
          return sabremetrics.filter((r) =>
            r.season_id === selectedSeason ||
            (pairedGntId != null && r.season_id === pairedGntId),
          );
        })();
    return base.filter((r) =>
      r.is_gauntlet ? includeGauntlet : includeRegular,
    );
  }, [selectedSeason, sabremetrics, includeRegular, includeGauntlet, regularToGauntlet]);

  const filteredPlayerSabremetrics = useMemo(
    () => filteredLeagueSabremetrics.filter((r) => r.player_id === playerId),
    [filteredLeagueSabremetrics, playerId],
  );

  const playerTabs: { key: PlayerTab; label: string }[] = [
    { key: 'stats', label: 'Overview' },
    { key: 'matches', label: `Matches${playedHistory.length > 0 ? ` (${playedHistory.length})` : ''}` },
    { key: 'advanced', label: 'Advanced Stats' },
    { key: 'matchups', label: 'H2H' },
  ];
  // Gated on the full career history (not the season-filtered `filtered`), same as
  // Trophy Case below — a tab's mere existence shouldn't flicker as the season filter
  // is toggled (docs/patterns.md "Gate a tab on data, not 'always render it'"). Requires
  // an actual generated replay (`replay_status === 'ready'`), not just a played match —
  // a played match with no replay yet has nothing for this tab to show. There's no
  // admin action reachable from this page that would produce a first replay, so unlike
  // MatchRecapTab's 2D Replay sub-tab this stays hidden rather than shown empty.
  if (history.some((r) => r.map && isPlayedScore(r.final_score) && r.replay_status === 'ready')) {
    playerTabs.push({ key: 'trails', label: 'Pathing' });
  }
  if (trophies.length > 0) {
    playerTabs.push({ key: 'trophies', label: `Trophy Case${filteredTrophies.length > 0 ? ` (${filteredTrophies.length})` : ''}` });
  }
  // Falls back to the first surviving tab when `tab` names one this player doesn't have (e.g. a
  // stale `?tab=trails` link for a player with no ready replay).
  const tab = resolveTab(rawTab, playerTabs);

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
              <WLChip key={r.id ?? i} won={r.is_win} />
            ))
          )}
        </div>
      </div>

      {/* Next Match — below Last 5 */}
      {nextMatch && (
        <NextMatchLink
          className="mb-4"
          matchId={nextMatch.match_id}
          map={nextMatch.map}
          opponents={opponentNames(nextMatch)}
          scheduledAt={nextMatch.scheduled_at}
        />
      )}

      {/* Tab bar + filter controls */}
      <TabBar
        bordered
        className="mb-6"
        controls={
          <CareerSeasonControls
            includeRegular={includeRegular}
            includeGauntlet={includeGauntlet}
            toggleRegular={toggleRegular}
            toggleGauntlet={toggleGauntlet}
            regularSeasons={regularSeasons}
            gauntletSeasons={gauntletSeasons}
            selectedSeason={selectedSeason}
            setSelectedSeason={setSelectedSeason}
          />
        }
      >
        {playerTabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={tabCls(tab === t.key)}
          >
            {t.label}
          </button>
        ))}
      </TabBar>

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
          <StatTileGrid
            columns="grid-cols-4 sm:grid-cols-5 lg:grid-cols-10"
            tiles={[
              { label: 'Games', value: agg.matches },
              { label: 'W-L', value: `${agg.wins}-${agg.losses}` },
              { label: 'Win rate', value: `${agg.wr.toFixed(1)}%` },
              { label: 'RWR%', value: `${agg.rwr.toFixed(1)}%` },
              { label: 'Kills', value: agg.kills },
              { label: 'Assists', value: agg.assists },
              { label: 'Deaths', value: agg.deaths },
              { label: 'K/D', value: agg.kd.toFixed(2) },
              { label: 'ADR', value: agg.adr.toFixed(2) },
              ...(peakEhog !== null ? [{ label: 'Peak EHOG', value: peakEhog.toFixed(2) }] : []),
            ]}
          />

          {isCareer && activeSeasons.length > 0 && (
            <>
              <SectionLabel>Season history</SectionLabel>
              <LeaderboardTable
                firstColMode="season"
                stickyNameCol={false}
                rows={activeSeasons.map((s): LeaderboardRowWithId => {
                  const pairedGntId = regularToGauntlet.get(s.id);
                  const seasonRows = history.filter((r) => {
                    if (r.season_id === s.id) return r.is_gauntlet ? includeGauntlet : includeRegular;
                    if (pairedGntId != null && r.season_id === pairedGntId) return includeGauntlet;
                    return false;
                  });
                  const a = aggregatePlayerStats(seasonRows);
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
                <EmptyState message="No map data." />
              ) : (
                <StatTable>
                  <thead>
                    <tr>
                      <Th align="left">Map</Th>
                      <Th align="right">Games</Th>
                      <Th align="right">Wins</Th>
                      <Th align="right">Picks</Th>
                      <Th align="right">Bans</Th>
                      <Th align="right">No-picks</Th>
                      <Th align="right">Pick &amp; won</Th>
                      <Th align="right">CT</Th>
                      <Th align="right">T</Th>
                      <Th align="right">Avg rounds</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {playerMapStats.map((m) => (
                      <Tr key={m.map} clickable>
                        <MapCell map={m.map} />
                        <Td>{m.games}</Td>
                        <Td>{m.wins}</Td>
                        <Td>{m.picked}</Td>
                        <Td muted>{m.banned}</Td>
                        <Td muted>{m.noPicked}</Td>
                        <Td>{m.pickedAndWon}</Td>
                        <Td>{m.ctPlayed}</Td>
                        <Td>{m.tPlayed}</Td>
                        <Td muted>{m.games > 0 ? m.avgRounds.toFixed(1) : '—'}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </StatTable>
              )}
            </div>

            {/* Side Stats */}
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Side stats</span>
              </div>
              {playerSideStats.every((s) => s.played === 0) ? (
                <EmptyState message="No side data." />
              ) : (
                <StatTable>
                  <thead>
                    <tr>
                      <Th align="left">Side</Th>
                      <Th align="right">Played</Th>
                      <Th align="right">Times Picked</Th>
                      <Th align="right">W-L</Th>
                      <Th align="right">RWR%</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {playerSideStats.map((s) => (
                      <Tr key={s.side}>
                        <NameTd>{s.side}</NameTd>
                        <Td>{s.played}</Td>
                        <Td>{s.numTimesPicked}</Td>
                        <Td>{s.wins}-{s.losses}</Td>
                        <Td>{s.roundsPlayed > 0 ? `${(s.roundsWon / s.roundsPlayed * 100).toFixed(1)}%` : '—'}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </StatTable>
              )}
            </div>
          </div>

          <SectionLabel>Map stats</SectionLabel>
          {maps.length === 0 ? (
            <EmptyState message="No map data." />
          ) : (
            <StatTable>
              <thead>
                <tr>
                  <SortableTh label="Map" sortKey="map" state={mapSortState} onSort={clickMapSort} />
                  <SortableTh label="W-L" sortKey="record" state={mapSortState} onSort={clickMapSort} align="right" />
                  <SortableTh label="WR%" sortKey="wr" state={mapSortState} onSort={clickMapSort} align="right" />
                  <SortableTh label="RWR%" sortKey="rwr" state={mapSortState} onSort={clickMapSort} align="right" />
                  <SortableTh label="ADR" sortKey="adr" state={mapSortState} onSort={clickMapSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {[...maps]
                  .sort((a, b) => {
                    let v = 0;
                    switch (mapSort) {
                      case 'map':    v = a.map.localeCompare(b.map); break;
                      case 'record': v = canonicalSortValues(a, b); break;
                      case 'wr':     v = b.wr - a.wr; break;
                      case 'rwr':    v = b.rwr - a.rwr; break;
                      case 'adr':    v = b.adr - a.adr; break;
                    }
                    return mapAsc ? -v : v;
                  })
                  .map((m) => (
                    <Tr key={m.map} clickable>
                      <MapCell map={m.map} />
                      <Td>{m.wins}-{m.losses}</Td>
                      <Td>
                        {m.wr.toFixed(1)}%
                        <span className="inline-block w-[60px] h-[4px] bg-[var(--color-bg-secondary)] ml-2 align-middle">
                          <span className="block h-full bg-[var(--color-accent-green-fill)]" style={{ width: `${Math.max(0, Math.min(100, m.wr))}%` }} />
                        </span>
                      </Td>
                      <Td>{m.rwr.toFixed(1)}%</Td>
                      <Td bold>{m.adr.toFixed(2)}</Td>
                    </Tr>
                  ))}
              </tbody>
            </StatTable>
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
            <div role="tablist" className="flex items-center gap-0 border-b border-[var(--color-border-primary)] mb-6">
              <button role="tab" aria-selected={matchesSubTab === 'history'} onClick={() => setMatchesSubTab('history')} className={tabCls(matchesSubTab === 'history')}>
                History
              </button>
              <button role="tab" aria-selected={matchesSubTab === 'upcoming'} onClick={() => setMatchesSubTab('upcoming')} className={tabCls(matchesSubTab === 'upcoming')}>
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
                  loggedInPlayerId={loggedInPlayerId}
                  containerVariant="standalone"
                />
              ))}
            </div>
          ) : (
            <>
              {playedHistory.length === 0 ? (
                <EmptyState message="No matches played yet." />
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
                      loggedInPlayerId={loggedInPlayerId}
                      ehogDeltas={matchDeltas[h.match_id] ?? null}
                      containerVariant="standalone"
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Advanced Stats tab */}
      {tab === 'advanced' && (
        <SabremetricsLeaderboardView rows={filteredPlayerSabremetrics} leagueRows={filteredLeagueSabremetrics} singlePlayer kills={filteredKills} weaponClassStats={filteredWeaponClassStats} economyRows={filteredEconomyStats} hasEconomyData={economyStats.length > 0} />
      )}

      {/* Matchups tab */}
      {tab === 'matchups' && (
        <MatchupsTab playerId={playerId} h2hData={h2hData} />
      )}

      {/* Pathing tab — replay every round the player's played on a map, at once */}
      {tab === 'trails' && (
        <PlayerTrailsTab playerId={playerId} playerName={playerName} history={filtered} />
      )}

      {/* Trophy Case tab */}
      {tab === 'trophies' && (
        <>
          <SectionLabel>Trophy case</SectionLabel>
          {filteredTrophies.length === 0 ? (
            <EmptyState message="No trophies for the current filter." />
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
                      <CompactTable widths={['w-9', 'w-9', 'w-9', 'w-12', 'w-14', 'w-12']}>
                        <thead>
                          <tr>
                            <CompactTh align="right">K</CompactTh>
                            <CompactTh align="right">A</CompactTh>
                            <CompactTh align="right">D</CompactTh>
                            <CompactTh align="right">WR%</CompactTh>
                            <CompactTh align="right">Rounds</CompactTh>
                            <CompactTh align="right">ADR</CompactTh>
                          </tr>
                        </thead>
                        <tbody>
                          <CompactTr>
                            <CompactTd bold>{t.stats.kills}</CompactTd>
                            <CompactTd bold>{t.stats.assists}</CompactTd>
                            <CompactTd bold>{t.stats.deaths}</CompactTd>
                            <CompactTd bold>{t.stats.win_rate_percentage.toFixed(1)}%</CompactTd>
                            <CompactTd bold>{t.stats.rounds_won}-{t.stats.rounds_lost}</CompactTd>
                            <CompactTd bold>{t.stats.overall_adr.toFixed(2)}</CompactTd>
                          </CompactTr>
                        </tbody>
                      </CompactTable>
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
