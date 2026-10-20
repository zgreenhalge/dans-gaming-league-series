import type { H2HData } from '../h2h';
import type { LeaderboardRowWithId } from '../types';
import { deriveKd, deriveKda, mergeLeaderboardRows } from '../util';
import { getCurrentEhogRating } from './ehog';
import { getGauntletStats } from './gauntlet';
import { bestFriendOf, worstNightmareOf, type PersonalMatchup } from './h2h';
import { getCareerLeaderboard } from './leaderboard';
import { getPlayer, lastPlayed, nextUpcoming, opponentNames, type PlayerHistoryRow } from './player';

// The home page's "My Stats" panel: one signed-in player's career figures, upcoming match, recent
// results and their best friend / worst nightmare. Career-scoped throughout — EHOG, W-L, KDA and ADR
// come from the regular and gauntlet career leaderboards merged (the Statistics page's default
// view), matches from the player's full history, and the matchups from the career H2H.

/** How many results the panel's Match history lists. */
const MY_STATS_RECENT_LIMIT = 5;

/** One played match in the panel's Match history, from the player's side. `score` is the stored
 *  `final_score` (shirts–skins), shown as-is like every other match card. */
export interface MyStatsMatch {
  matchId: number;
  won: boolean;
  score: string;
  opponents: string;
  map: string | null;
}

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

export interface MyStats {
  playerId: number;
  playerName: string;
  /** Current EHOG rating; `null` before the player has one. */
  ehog: number | null;
  record: { wins: number; losses: number };
  /** Career (kills + assists) per death — see `deriveKda()`. */
  kda: number;
  /** Career kills per death — see `deriveKd()`. */
  kd: number;
  adr: number;
  next: MyStatsNextMatch | null;
  /** Newest first, at most `MY_STATS_RECENT_LIMIT`. */
  recent: MyStatsMatch[];
  bestFriend: MyStatsPlayer | null;
  worstNightmare: MyStatsPlayer | null;
}

/**
 * Assembles a player's `MyStats` from already-fetched inputs — the pure core of `getMyStats()`.
 * `history` is `getPlayer()`'s newest-first `PlayerHistoryRow[]`; `leaderboard` the career
 * leaderboard; `h2h` the career H2H data.
 */
export function buildMyStats(input: {
  playerId: number;
  playerName: string;
  leaderboard: LeaderboardRowWithId[];
  ehog: number | null;
  history: PlayerHistoryRow[];
  h2h: H2HData;
}): MyStats {
  const { playerId, playerName, leaderboard, ehog, history, h2h } = input;

  const row = leaderboard.find((r) => r.player_id === playerId) ?? null;

  const nameOf = new Map(h2h.players.map((p) => [p.id, p.name]));
  const toPlayer = (m: PersonalMatchup | null): MyStatsPlayer | null =>
    m ? { id: m.otherId, name: nameOf.get(m.otherId) ?? `#${m.otherId}`, wins: m.wins, losses: m.losses } : null;

  const next = nextUpcoming(history);

  return {
    playerId,
    playerName,
    ehog,
    record: { wins: row?.matches_won ?? 0, losses: row?.matches_lost ?? 0 },
    kda: row ? deriveKda(row) : 0,
    kd: row ? deriveKd(row) : 0,
    adr: row?.overall_adr ?? 0,
    next: next
      ? { matchId: next.match_id, opponents: opponentNames(next), map: next.map, scheduledAt: next.scheduled_at }
      : null,
    recent: lastPlayed(history, MY_STATS_RECENT_LIMIT).map((r) => ({
      matchId: r.match_id,
      won: r.is_win,
      score: r.final_score ?? '',
      opponents: opponentNames(r),
      map: r.map,
    })),
    bestFriend: toPlayer(bestFriendOf(h2h.duos, playerId)),
    worstNightmare: toPlayer(worstNightmareOf(h2h.rivals, playerId)),
  };
}

/** The home page's My Stats data for `playerId`, or `null` when that player doesn't exist. `h2h` is
 *  the career H2H data the page already holds for its Top duos / Hottest Rivalries panels. */
export async function getMyStats(playerId: number, h2h: H2HData): Promise<MyStats | null> {
  const [regular, gauntlet, detail, ehog] = await Promise.all([
    getCareerLeaderboard(),
    getGauntletStats(),
    getPlayer(playerId),
    getCurrentEhogRating(playerId),
  ]);
  if (!detail) return null;
  return buildMyStats({
    playerId,
    playerName: detail.player.name,
    leaderboard: mergeLeaderboardRows(regular, gauntlet.career),
    ehog,
    history: detail.history,
    h2h,
  });
}
