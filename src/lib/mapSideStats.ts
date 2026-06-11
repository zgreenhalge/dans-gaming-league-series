import type { Match, Faction } from './types';
import { isPlayedScore } from './util';

export interface RosterStat {
  faction: Faction;
  is_win: boolean;
}

export interface MapPickBanStat {
  map: string;
  picked: number;
  ctPicked: number;
  tPicked: number;
  pickedAndWon: number;
}

export interface PerSideStat {
  side: 'CT' | 'T';
  numTimesPicked: number;
  wins: number;
  losses: number;
}

/**
 * Determines which faction won a match by checking if any player from that faction has is_win === true.
 * Returns 'SHIRTS' or 'SKINS', or null if the result is ambiguous.
 */
function getWinningFaction(stats: RosterStat[]): Faction | null {
  const shirtsWin = stats.filter((s) => s.faction === 'SHIRTS').some((s) => s.is_win);
  const skinsWin = stats.filter((s) => s.faction === 'SKINS').some((s) => s.is_win);

  if (shirtsWin && !skinsWin) return 'SHIRTS';
  if (skinsWin && !shirtsWin) return 'SKINS';
  return null;
}

interface MatchWithStats extends Match {
  shirts_stats: RosterStat[];
  skins_stats: RosterStat[];
}

export function aggregateMapPickBanStats(matches: MatchWithStats[]): MapPickBanStat[] {
  const buckets = new Map<string, MatchWithStats[]>();

  for (const m of matches) {
    if (!isPlayedScore(m.final_score) || !m.picked_map) continue;
    const key = m.picked_map.trim().toLowerCase();
    const list = buckets.get(key) ?? [];
    list.push(m);
    buckets.set(key, list);
  }

  const out: MapPickBanStat[] = [];
  for (const [key, matchList] of buckets) {
    const display = matchList[0]?.picked_map ?? key;
    let picked = 0;
    let ctPicked = 0;
    let tPicked = 0;
    let pickedAndWon = 0;

    for (const m of matchList) {
      picked++;

      // Count sides: skins_starting_side indicates which side skins starts on
      if (m.skins_starting_side === 'CT') {
        ctPicked++;
      } else if (m.skins_starting_side === 'T') {
        tPicked++;
      }

      // Picked and won: count if the team that picked the map won
      const shirtsPicked = m.shirts_pick === m.picked_map;
      const teamThatPicked = shirtsPicked ? 'SHIRTS' : 'SKINS';
      const stats = [...m.shirts_stats, ...m.skins_stats];
      const winner = getWinningFaction(stats);
      if (winner === teamThatPicked) {
        pickedAndWon++;
      }
    }

    out.push({
      map: display,
      picked,
      ctPicked,
      tPicked,
      pickedAndWon,
    });
  }

  return out.sort((a, b) => b.picked - a.picked);
}

export function aggregatePerSideStats(matches: MatchWithStats[]): PerSideStat[] {
  const playedMatches = matches.filter((m) => isPlayedScore(m.final_score));
  const ctStats = { wins: 0, losses: 0 };
  const tStats = { wins: 0, losses: 0 };

  for (const m of playedMatches) {
    if (!m.skins_starting_side) continue;

    // Determine the winning faction
    const stats = [...m.shirts_stats, ...m.skins_stats];
    const winner = getWinningFaction(stats);

    // The "picked side" is the side chosen by the team that didn't pick the map
    const shirtsPicked = m.shirts_pick === m.picked_map;
    const pickedSide = shirtsPicked ? m.skins_starting_side : (m.skins_starting_side === 'CT' ? 'T' : 'CT');

    // Track wins/losses for the picked side
    const targetStats = pickedSide === 'CT' ? ctStats : tStats;

    // Determine if the team that picked this side won
    // If pickedSide is CT and skins started on CT, then we check if skins won
    // If pickedSide is T and skins started on T, then we check if skins won
    // Otherwise, check if shirts won
    const pickedByShirts = pickedSide === m.skins_starting_side;
    const sideTeamWon = pickedByShirts ? (winner === 'SHIRTS') : (winner === 'SKINS');

    if (sideTeamWon) {
      targetStats.wins++;
    } else if (winner) {
      targetStats.losses++;
    }
  }

  return [
    {
      side: 'CT',
      numTimesPicked: ctStats.wins + ctStats.losses,
      wins: ctStats.wins,
      losses: ctStats.losses,
    },
    {
      side: 'T',
      numTimesPicked: tStats.wins + tStats.losses,
      wins: tStats.wins,
      losses: tStats.losses,
    },
  ];
}
