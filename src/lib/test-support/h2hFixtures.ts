import type { DuoStats, H2HData } from '@/lib/h2h';

/** Two named players sharing an id/name/avatar shape, for tests that need real (non-empty) H2H data
 * to render a clickable duo/rival row. */
export const H2H_PLAYERS = [
  { id: 1, name: 'Alice', steam_avatar_url: null },
  { id: 2, name: 'Bob', steam_avatar_url: null },
];

/** A single duo's aggregated record for `H2H_PLAYERS`' Alice+Bob pair — override only the fields a
 * given test cares about. */
export function duoStats(overrides: Partial<DuoStats> = {}): DuoStats {
  const playerStats = { kills: 20, assists: 5, deaths: 15, adr: 75, rwr: 57, roundsWon: 40, roundsPlayed: 70 };
  return {
    playerA: 1,
    playerB: 2,
    gamesPlayed: 5,
    wins: 3,
    losses: 2,
    combinedAdr: 150,
    combinedKills: 40,
    combinedAssists: 10,
    combinedDeaths: 30,
    roundsWon: 40,
    roundsPlayed: 70,
    aStats: playerStats,
    bStats: playerStats,
    bestMap: null,
    mapBreakdown: [],
    matches: [],
    ...overrides,
  };
}

/** `H2HData` with one real, clickable duo (Alice & Bob) — for tests exercising `H2HSection`'s
 * selection/hover interactions rather than its empty state. */
export function h2hDataWithDuo(overrides: Partial<H2HData> = {}): H2HData {
  return {
    duos: [duoStats()],
    rivals: [],
    players: H2H_PLAYERS,
    ...overrides,
  };
}
