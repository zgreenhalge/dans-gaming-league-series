'use client';

import { useState, useMemo } from 'react';
import LeaderboardTable from './LeaderboardTable';
import { MatchCard } from './MatchCard';
import { useSeasonFilter, SeasonFilter } from './SeasonFilter';
import { tabCls } from '@/lib/util';
import type { MapMatchRow, MapDetail, MapPlayerStat } from '@/lib/queries';
import type { LeaderboardRowWithId } from '@/lib/types';

type Tab = 'stats' | 'matches';

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
      byPlayer.set(s.player_id, agg);
    }
  }

  return Array.from(byPlayer.values()).map((a) => {
    const rp = a.total_rounds_played;
    const rw = a.total_rounds_won;
    return {
      season_id: 0,
      player_id: a.player_id,
      player_name: a.player_name,
      matches_played: a.matches_played,
      matches_won: a.matches_won,
      matches_lost: a.matches_lost,
      win_rate_percentage: a.matches_played > 0 ? (a.matches_won / a.matches_played) * 100 : 0,
      total_kills: a.total_kills,
      total_assists: a.total_assists,
      total_deaths: a.total_deaths,
      kd_ratio: a.total_deaths > 0 ? a.total_kills / a.total_deaths : a.total_kills,
      total_damage: a.total_damage,
      total_rounds_played: rp,
      total_rounds_won: rw,
      rwr_percentage: rp > 0 ? (rw / rp) * 100 : 0,
      overall_adr: rp > 0 ? a.total_damage / rp : 0,
    };
  }).sort((a, b) => b.overall_adr - a.overall_adr);
}

export default function MapDetailView({ detail }: { detail: MapDetail }) {
  const { includeRegular, includeGauntlet, selectedSeason, toggleRegular, toggleGauntlet, setSelectedSeason } = useSeasonFilter();
  const [tab, setTab] = useState<Tab>('stats');

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
      <div className="flex items-center border-b border-[var(--color-border-primary)] mb-4">
        <button type="button" className={tabCls(tab === 'stats')} onClick={() => setTab('stats')}>
          Stats
        </button>
        <button type="button" className={tabCls(tab === 'matches')} onClick={() => setTab('matches')}>
          Matches
          <span className="ml-1.5 font-mono text-[10px] text-[var(--color-text-secondary)]">
            ({filteredMatches.length})
          </span>
        </button>
        <SeasonFilter
          filter={{ includeRegular, includeGauntlet, toggleRegular, toggleGauntlet, selectedSeason }}
          seasons={uniqueSeasons}
          onSeasonChange={setSelectedSeason}
          className="ml-auto flex items-center gap-5 pb-0.5"
        />
      </div>

      {tab === 'stats' && (
        filteredPlayerStats.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">No data for this selection.</div>
        ) : (
          <LeaderboardTable rows={filteredPlayerStats} showMedals={false} />
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
                  seasonId: m.season_id,
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
    </div>
  );
}
