import type { LeaderboardRowWithId } from '@/lib/types';
import type { H2HData } from '@/lib/queries';

/** A single, fully-shaped `LeaderboardRowWithId` for component tests that need a row to render but
 * don't exercise the stat math itself — override only the fields a given test cares about. */
export function leaderboardRow(overrides: Partial<LeaderboardRowWithId> = {}): LeaderboardRowWithId {
  return {
    season_id: 1,
    player_id: 1,
    player_name: 'Alice',
    matches_played: 1,
    matches_won: 1,
    matches_lost: 0,
    win_rate_percentage: 100,
    total_kills: 10,
    total_assists: 2,
    total_deaths: 5,
    kd_ratio: 2,
    total_damage: 500,
    total_rounds_played: 13,
    total_rounds_won: 8,
    rwr_percentage: 61.5,
    overall_adr: 38.46,
    kills_in_wins: 10,
    deaths_in_wins: 5,
    kills_in_losses: 0,
    deaths_in_losses: 0,
    ...overrides,
  };
}

/** An empty `H2HData` — for tests where the H2H tab/section isn't the thing under test. */
export const EMPTY_H2H: H2HData = { duos: [], rivals: [], players: [] };
