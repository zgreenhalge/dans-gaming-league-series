import { supabase } from '../supabase';
import type { LeaderboardRowWithId } from '../types';
import { canonicalSort, isPlayedScore } from '../util';
import { getSeasons } from './seasons';
import { getAllLeaderboards } from './leaderboard';
import { getGauntletSeasonLeaderboard } from './gauntlet';


export interface TrophyStatLine {
  kills: number;
  assists: number;
  deaths: number;
  win_rate_percentage: number;
  rounds_won: number;
  rounds_lost: number;
  overall_adr: number;
}

export interface TrophyEntry {
  season_id: number;
  season_name: string;
  is_gauntlet: boolean;
  rank: 1 | 2 | 3;
  stats: TrophyStatLine;
}

function toTrophyStats(r: LeaderboardRowWithId): TrophyStatLine {
  return {
    kills: r.total_kills,
    assists: r.total_assists,
    deaths: r.total_deaths,
    win_rate_percentage: r.win_rate_percentage,
    rounds_won: r.total_rounds_won,
    rounds_lost: Math.max(0, r.total_rounds_played - r.total_rounds_won),
    overall_adr: r.overall_adr,
  };
}

/**
 * All podium finishes (gold/silver/bronze) across every season, keyed by player_id.
 * Regular seasons: ARCHIVED only, ranked by canonical order (WR% -> RWR% -> ADR),
 * matching LeaderboardTable's medal logic. Gauntlets: champion + runners-up from
 * a fully-played final round, matching GauntletStandings.
 */
export async function getAllSeasonMedalists(): Promise<Map<number, TrophyEntry[]>> {
  const [seasons, leaderboards] = await Promise.all([getSeasons(), getAllLeaderboards()]);

  const out = new Map<number, TrophyEntry[]>();
  const add = (playerId: number, entry: TrophyEntry) => {
    const list = out.get(playerId) ?? [];
    list.push(entry);
    out.set(playerId, list);
  };

  // Regular seasons: ARCHIVED only, canonical rank WR% -> RWR% -> ADR, top 3
  for (const season of seasons) {
    if (season.is_gauntlet || season.status !== 'ARCHIVED') continue;
    const rows = leaderboards.get(season.id) ?? [];
    if (rows.length === 0) continue;
    [...rows]
      .sort(canonicalSort)
      .slice(0, 3)
      .forEach((r, i) => {
        add(r.player_id, {
          season_id: season.id,
          season_name: season.name,
          is_gauntlet: false,
          rank: (i + 1) as 1 | 2 | 3,
          stats: toTrophyStats(r),
        });
      });
  }

  // Gauntlets: champion + 2nd/3rd from a fully-played final round
  const gauntletSeasons = seasons.filter((s) => s.is_gauntlet);
  if (gauntletSeasons.length > 0) {
    const seasonIds = gauntletSeasons.map((s) => s.id);

    // The player_season_leaderboard view excludes playoff games, and gauntlet
    // matches are always flagged as playoff games — so gauntlet stats have to
    // be computed separately rather than read from `leaderboards`.
    const gauntletLeaderboards = new Map<number, LeaderboardRowWithId[]>(
      await Promise.all(
        gauntletSeasons.map(async (s): Promise<[number, LeaderboardRowWithId[]]> => [s.id, await getGauntletSeasonLeaderboard(s.id)]),
      ),
    );

    const { data: weekData } = await supabase
      .from('weeks')
      .select('id, season_id, week_number')
      .in('season_id', seasonIds);
    const weekRows = (weekData ?? []) as { id: number; season_id: number; week_number: number }[];

    if (weekRows.length > 0) {
      const weekIds = weekRows.map((w) => w.id);
      const { data: matchData } = await supabase
        .from('matches')
        .select('id, week_id, final_score')
        .in('week_id', weekIds);
      const matchRows = (matchData ?? []) as { id: number; week_id: number; final_score: string | null }[];

      const matchIds = matchRows.map((m) => m.id);
      const { data: statData } = matchIds.length
        ? await supabase.from('player_match_stats').select('match_id, player_id, is_win, rounds_won, rounds_played, adr').in('match_id', matchIds)
        : { data: [] as { match_id: number; player_id: number; is_win: boolean; rounds_won: number; rounds_played: number; adr: number }[] };
      const statRows = (statData ?? []) as { match_id: number; player_id: number; is_win: boolean; rounds_won: number; rounds_played: number; adr: number }[];

      const matchesByWeek = new Map<number, { id: number; final_score: string | null }[]>();
      for (const m of matchRows) {
        const list = matchesByWeek.get(m.week_id) ?? [];
        list.push(m);
        matchesByWeek.set(m.week_id, list);
      }
      const statsByMatch = new Map<number, { player_id: number; is_win: boolean }[]>();
      for (const s of statRows) {
        const list = statsByMatch.get(s.match_id) ?? [];
        list.push(s);
        statsByMatch.set(s.match_id, list);
      }

      for (const season of gauntletSeasons) {
        const seasonWeeks = weekRows.filter((w) => w.season_id === season.id);
        if (seasonWeeks.length === 0) continue;
        const finalWeek = seasonWeeks.reduce((best, w) => (w.week_number > best.week_number ? w : best));
        const finalMatches = matchesByWeek.get(finalWeek.id) ?? [];
        if (finalMatches.length === 0 || !finalMatches.every((m) => isPlayedScore(m.final_score))) continue;

        const records = new Map<number, { player_id: number; wins: number }>();
        for (const m of finalMatches) {
          for (const s of statsByMatch.get(m.id) ?? []) {
            const prev = records.get(s.player_id) ?? { player_id: s.player_id, wins: 0 };
            if (s.is_win) prev.wins++;
            records.set(s.player_id, prev);
          }
        }
        const recordList = Array.from(records.values());
        const champion = recordList.find((r) => r.wins === 2) ?? null;
        if (!champion) continue;

        const seasonLeaderboard = gauntletLeaderboards.get(season.id) ?? [];
        const statsByPlayer = new Map(seasonLeaderboard.map((r) => [r.player_id, r]));

        const finalMatchIds = new Set(finalMatches.map((m) => m.id));
        const finalRoundAgg = new Map<number, { rounds_won: number; rounds_played: number; total_damage: number }>();
        for (const s of statRows.filter((s) => finalMatchIds.has(s.match_id))) {
          const prev = finalRoundAgg.get(s.player_id) ?? { rounds_won: 0, rounds_played: 0, total_damage: 0 };
          prev.rounds_won += s.rounds_won;
          prev.rounds_played += s.rounds_played;
          prev.total_damage += s.adr * s.rounds_played;
          finalRoundAgg.set(s.player_id, prev);
        }

        const contenders = recordList
          .filter((r) => r.wins === 1)
          .sort((a, b) => {
            const af = finalRoundAgg.get(a.player_id);
            const bf = finalRoundAgg.get(b.player_id);
            if (!af || !bf) return 0;
            const aRwr = af.rounds_played > 0 ? af.rounds_won / af.rounds_played : 0;
            const bRwr = bf.rounds_played > 0 ? bf.rounds_won / bf.rounds_played : 0;
            const aAdr = af.rounds_played > 0 ? af.total_damage / af.rounds_played : 0;
            const bAdr = bf.rounds_played > 0 ? bf.total_damage / bf.rounds_played : 0;
            return bRwr - aRwr || bAdr - aAdr;
          });

        const zeroStats: TrophyStatLine = {
          kills: 0, assists: 0, deaths: 0, win_rate_percentage: 0, rounds_won: 0, rounds_lost: 0, overall_adr: 0,
        };
        const podium: { player_id: number; rank: 1 | 2 | 3 }[] = [
          { player_id: champion.player_id, rank: 1 },
          ...(contenders[0] ? [{ player_id: contenders[0].player_id, rank: 2 as const }] : []),
          ...(contenders[1] ? [{ player_id: contenders[1].player_id, rank: 3 as const }] : []),
        ];
        for (const { player_id, rank } of podium) {
          const ps = statsByPlayer.get(player_id);
          add(player_id, {
            season_id: season.id,
            season_name: season.name,
            is_gauntlet: true,
            rank,
            stats: ps ? toTrophyStats(ps) : zeroStats,
          });
        }
      }
    }
  }

  return out;
}
