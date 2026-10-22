import type { H2HData } from '../h2h';
import type { LeaderboardRowWithId } from '../types';
import { bestFriendOf, worstNightmareOf, type PersonalMatchup } from '../h2h-ratings';
import { nextUpcoming, opponentNames, type PlayerHistoryRow } from './player';
import { buildPlayerSummary, loadPlayerSummaryInputs, type PlayerSummary } from './playerSummary';

// The home page's "My Stats" panel: one signed-in player's `PlayerSummary` (`playerSummary.ts`) plus
// their upcoming match and best friend / worst nightmare, which come from the career H2H.

/** The player's next unplayed match. */
export interface MyStatsNextMatch {
  matchId: number;
  opponents: string;
  map: string | null;
  scheduledAt: string | null;
}

/** The other player in a best-friend / worst-nightmare row, with the player's record against or
 *  alongside them. */
export interface MyStatsPlayer {
  id: number;
  name: string;
  wins: number;
  losses: number;
}

/** The signed-in player's home panel: their `PlayerSummary` (the figures the player hover card
 *  shares) plus the personal extras only the panel shows. */
export interface MyStats extends PlayerSummary {
  next: MyStatsNextMatch | null;
  bestFriend: MyStatsPlayer | null;
  worstNightmare: MyStatsPlayer | null;
}

/**
 * Assembles a player's `MyStats` from already-fetched inputs — the pure core of `getMyStats()`.
 * `history` is the player's newest-first `PlayerHistoryRow[]`; `leaderboard` the career
 * leaderboard; `h2h` the career H2H data.
 */
export function buildMyStats(input: {
  playerId: number;
  playerName: string;
  avatarUrl: string | null;
  leaderboard: LeaderboardRowWithId[];
  ehog: number | null;
  history: PlayerHistoryRow[];
  h2h: H2HData;
}): MyStats {
  const { playerId, playerName, avatarUrl, leaderboard, ehog, history, h2h } = input;

  const nameOf = new Map(h2h.players.map((p) => [p.id, p.name]));
  const toPlayer = (m: PersonalMatchup | null): MyStatsPlayer | null =>
    m ? { id: m.otherId, name: nameOf.get(m.otherId) ?? `#${m.otherId}`, wins: m.wins, losses: m.losses } : null;

  const next = nextUpcoming(history);

  return {
    ...buildPlayerSummary({ playerId, playerName, avatarUrl, leaderboard, ehog, history }),
    next: next
      ? { matchId: next.match_id, opponents: opponentNames(next), map: next.map, scheduledAt: next.scheduled_at }
      : null,
    bestFriend: toPlayer(bestFriendOf(h2h.duos, playerId)),
    worstNightmare: toPlayer(worstNightmareOf(h2h.rivals, playerId)),
  };
}

/** The home page's My Stats data for `playerId`, or `null` when that player doesn't exist. `h2h` is
 *  the career H2H data the page already holds for its Top duos / Hottest Rivalries panels. */
export async function getMyStats(playerId: number, h2h: H2HData): Promise<MyStats | null> {
  const inputs = await loadPlayerSummaryInputs(playerId);
  return inputs && buildMyStats({ ...inputs, h2h });
}
