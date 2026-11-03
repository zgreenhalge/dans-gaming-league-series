import type { LeaderboardRowWithId } from '../types';
import { deriveKd, deriveKda } from '../util';
import { getCurrentEhogRating } from './ehog';
import { getMergedCareerLeaderboard } from './leaderboard';
import { getPlayerRecent, lastPlayed, opponentNames, type PlayerHistoryRow } from './player';

// A player's career snapshot: EHOG, W-L, KDA, ADR and their last results. The home page's My Stats
// panel (`getMyStats()`, `queries/myStats.ts`) extends it with personal extras, and the player hover
// card (`GET /api/players/[id]/summary`) serves it as-is — one definition, so the two can't drift.
// Career-scoped throughout: EHOG, W-L, KDA and ADR come from the regular and gauntlet career
// leaderboards merged (the Statistics page's default view), results from the player's recent history.

/** How many recent results a summary carries. */
export const PLAYER_SUMMARY_RECENT_LIMIT = 5;

/** One played match in a summary's recent results, from the player's side. `score` is the stored
 *  `final_score` (shirts–skins), shown as-is like every other match card. */
export interface PlayerSummaryMatch {
  matchId: number;
  won: boolean;
  score: string;
  opponents: string;
  map: string | null;
}

export interface PlayerSummary {
  playerId: number;
  playerName: string;
  avatarUrl: string | null;
  /** Current EHOG rating; `null` before the player has one. */
  ehog: number | null;
  record: { wins: number; losses: number };
  /** Career (kills + assists) per death — see `deriveKda()`. */
  kda: number;
  /** Career kills per death — see `deriveKd()`. */
  kd: number;
  adr: number;
  /** Newest first, at most `PLAYER_SUMMARY_RECENT_LIMIT`. */
  recent: PlayerSummaryMatch[];
}

/**
 * Assembles a player's `PlayerSummary` from already-fetched inputs — the pure core of
 * `getPlayerSummary()`. `history` is the player's newest-first `PlayerHistoryRow[]`;
 * `leaderboard` the career leaderboard.
 */
export function buildPlayerSummary(input: {
  playerId: number;
  playerName: string;
  avatarUrl: string | null;
  leaderboard: LeaderboardRowWithId[];
  ehog: number | null;
  history: PlayerHistoryRow[];
}): PlayerSummary {
  const { playerId, playerName, avatarUrl, leaderboard, ehog, history } = input;
  const row = leaderboard.find((r) => r.player_id === playerId) ?? null;
  return {
    playerId,
    playerName,
    avatarUrl,
    ehog,
    record: { wins: row?.matches_won ?? 0, losses: row?.matches_lost ?? 0 },
    kda: row ? deriveKda(row) : 0,
    kd: row ? deriveKd(row) : 0,
    adr: row?.overall_adr ?? 0,
    recent: lastPlayed(history, PLAYER_SUMMARY_RECENT_LIMIT).map((r) => ({
      matchId: r.match_id,
      won: r.is_win,
      score: r.final_score ?? '',
      opponents: opponentNames(r),
      map: r.map,
    })),
  };
}

/** What `buildPlayerSummary()` is built from, fetched together: the career leaderboard (regular and
 *  gauntlet merged), the player with their recent history, and their current EHOG. `null` when the
 *  player doesn't exist. */
export async function loadPlayerSummaryInputs(playerId: number) {
  const [leaderboard, detail, ehog] = await Promise.all([
    getMergedCareerLeaderboard(),
    getPlayerRecent(playerId, PLAYER_SUMMARY_RECENT_LIMIT),
    getCurrentEhogRating(playerId),
  ]);
  if (!detail) return null;
  return {
    playerId,
    playerName: detail.player.name,
    avatarUrl: detail.player.steam_avatar_url,
    leaderboard,
    ehog,
    history: detail.history,
  };
}

/** `playerId`'s career summary, or `null` when that player doesn't exist. */
export async function getPlayerSummary(playerId: number): Promise<PlayerSummary | null> {
  const inputs = await loadPlayerSummaryInputs(playerId);
  return inputs && buildPlayerSummary(inputs);
}
