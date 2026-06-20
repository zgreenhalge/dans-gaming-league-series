'use client';

import { useState, useMemo } from 'react';
import LeaderboardTable from './LeaderboardTable';
import { MatchCard } from './MatchCard';
import { useSeasonFilter, SeasonFilter } from './SeasonFilter';
import TabBar from './TabBar';
import { AdvancedStatsView } from './AdvancedStatsView';
import { tabCls, canonicalSort, deriveRates } from '@/lib/util';
import type { MapMatchRow, MapDetail, MapPlayerStat, H2HData } from '@/lib/queries';
import type { LeaderboardRowWithId } from '@/lib/types';
import H2HSection from './H2HSection';

type Tab = 'leaderboard' | 'stats' | 'matches' | 'h2h';

function toRosterStat(s: MapPlayerStat) {
  return {
    player_id: s.player_id,
    player_name: s.player_name,
    kills: s.kills,
    assists: s.assists,
    deaths: s.deaths,
    adr: s.adr,
  };
}

function matchRight(m: MapMatchRow) {
  if (m.final_score) return { type: 'score' as const, score: m.final_score };
  return { type: 'pending' as const };
}

function aggregatePlayerStats(matches: MapMatchRow[]): LeaderboardRowWithId[] {
  type Agg = {
    player_id: number;
    player_name: string;
    matches_played: number;
    matches_won: number;
    matches_lost: number;
    total_kills: number;
    total_assists: number;
    total_deaths: number;
    total_damage: number;
    total_rounds_played: number;
    total_rounds_won: number;
    kills_in_wins: number;
    deaths_in_wins: number;
    kills_in_losses: number;
    deaths_in_losses: number;
  };

  const byPlayer = new Map<number, Agg>();

  for (const m of matches) {
    for (const s of [...m.shirts_stats, ...m.skins_stats]) {
      const agg = byPlayer.get(s.player_id) ?? {
        player_id: s.player_id,
        player_name: s.player_name,
        matches_played: 0, matches_won: 0, matches_lost: 0,
        total_kills: 0, total_assists: 0, total_deaths: 0,
        total_damage: 0, total_rounds_played: 0, total_rounds_won: 0,
        kills_in_wins: 0, deaths_in_wins: 0,
        kills_in_losses: 0, deaths_in_losses: 0,
      };
      agg.matches_played += 1;
      agg.matches_won += s.is_win ? 1 : 0;
      agg.matches_lost += s.is_win ? 0 : 1;
      agg.total_kills += s.kills;
      agg.total_assists += s.assists;
      agg.total_deaths += s.deaths;
      agg.total_damage += s.damage;
      agg.total_rounds_played += s.rounds_played;
      agg.total_rounds_won += s.rounds_won;
      agg.kills_in_wins += s.is_win ? s.kills : 0;
      agg.deaths_in_wins += s.is_win ? s.deaths : 0;
      agg.kills_in_losses += s.is_win ? 0 : s.kills;
      agg.deaths_in_losses += s.is_win ? 0 : s.deaths;
      byPlayer.set(s.player_id, agg);
    }
  }

  return (Array.from(byPlayer.values()).map((a) => ({
    season_id: 0,
    player_id: a.player_id,
    player_name: a.player_name,
    matches_played: a.matches_played,
    matches_won: a.matches_won,
    matches_lost: a.matches_lost,
    total_kills: a.total_kills,
    total_assists: a.total_assists,
    total_deaths: a.total_deaths,
    total_damage: a.total_damage,
    total_rounds_played: a.total_rounds_played,
    total_rounds_won: a.total_rounds_won,
    ...deriveRates(a),
    kills_in_wins: a.kills_in_wins,
    deaths_in_wins: a.deaths_in_wins,
    kills_in_losses: a.kills_in_losses,
    deaths_in_losses: a.deaths_in_losses,
  })).sort(canonicalSort)) as unknown as LeaderboardRowWithId[];
}

export default function MapDetailView({ detail, h2hData }: { detail: MapDetail; h2hData: H2HData }) {
  const { includeRegular, includeGauntlet, selectedSeason, toggleRegular, toggleGauntlet, setSelectedSeason } = useSeasonFilter();
  const [tab, setTab] = useState<Tab>('leaderboard');

  const uniqueSeasons = useMemo(() => {
    const seen = new Map<number, { id: number; name: string; is_gauntlet: boolean }>();
    for (const m of detail.matches) {
      if (!seen.has(m.season_id))
        seen.set(m.season_id, { id: m.season_id, name: m.season_name, is_gauntlet: m.is_gauntlet });
    }
    return Array.from(seen.values()).sort((a, b) => a.id - b.id);
  }, [detail.matches]);

  const filteredMatches = useMemo<MapMatchRow[]>(() => {
    return detail.matches.filter((m) => {
      if (selectedSeason !== 'all' && m.season_id !== selectedSeason) return false;
      if (m.is_gauntlet && m.is_playoff_game) return includeGauntlet;
      return includeRegular;
    });
  }, [detail.matches, includeRegular, includeGauntlet, selectedSeason]);

  const filteredPlayerStats = useMemo(
    () => aggregatePlayerStats(filteredMatches),
    [filteredMatches],
  );


  return (
    <div>
      {/* Tabs + filter controls */}
      <TabBar
        bordered
        className="mb-4"
        controls={
          <SeasonFilter
            filter={{ includeRegular, includeGauntlet, toggleRegular, toggleGauntlet, selectedSeason }}
            seasons={uniqueSeasons}
            onSeasonChange={setSelectedSeason}
          />
        }
      >
        <button type="button" className={tabCls(tab === 'leaderboard')} onClick={() => setTab('leaderboard')}>
          Leaderboard
        </button>
        <button type="button" className={tabCls(tab === 'stats')} onClick={() => setTab('stats')}>
          Stats
        </button>
        <button type="button" className={tabCls(tab === 'matches')} onClick={() => setTab('matches')}>
          Matches
          <span className="ml-1.5 font-mono text-[10px] text-[var(--color-text-secondary)]">
            ({filteredMatches.length})
          </span>
        </button>
        <button type="button" className={tabCls(tab === 'h2h')} onClick={() => setTab('h2h')}>
          H2H
        </button>
      </TabBar>

      {tab === 'leaderboard' && (
        filteredPlayerStats.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">No data for this selection.</div>
        ) : (
          <LeaderboardTable rows={filteredPlayerStats} showMedals={false} />
        )
      )}

      {tab === 'stats' && (
        filteredPlayerStats.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">No data for this selection.</div>
        ) : (
          <AdvancedStatsView rows={filteredPlayerStats} matches={filteredMatches} singleMap />
        )
      )}

      {tab === 'matches' && (
        filteredMatches.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">No matches for this selection.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredMatches.map((m) => (
              <MatchCard
                key={m.match_id}
                href={`/matches/${m.match_id}`}
                map={detail.name}
                label={{
                  type: 'player-history',
                  seasonNumber: m.season_number,
                  isGauntlet: m.is_gauntlet,
                  weekNumber: m.week_number,
                  matchNumber: m.match_number,
                }}
                right={matchRight(m)}
                shirtsStats={m.shirts_stats.map(toRosterStat)}
                skinsStats={m.skins_stats.map(toRosterStat)}
                containerVariant="inline"
              />
            ))}
          </div>
        )
      )}

      {tab === 'h2h' && <H2HSection data={h2hData} />}
    </div>
  );
}
