import type { DuoStats, H2HData } from '@/lib/h2h';
import type { MapMatchRow, MapPlayerStat } from '@/lib/queries';

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

/** A single `MapPlayerStat` row (defaults to `H2H_PLAYERS`' Alice, on SHIRTS) — for building a
 * `MapMatchRow` where two players share a faction, so a real duo forms once run through
 * `computeH2H`/`mapMatchRowsToH2HInput`. */
export function h2hPlayerStat(overrides: Partial<MapPlayerStat> = {}): MapPlayerStat {
  return {
    player_id: 1,
    player_name: 'Alice',
    faction: 'SHIRTS',
    kills: 20,
    assists: 5,
    deaths: 15,
    adr: 75,
    damage: 1000,
    rounds_played: 13,
    rounds_won: 8,
    is_win: true,
    ...overrides,
  };
}

/** A single played `MapMatchRow` with empty rosters by default — override `shirts_stats`/
 * `skins_stats` (with `h2hPlayerStat()`) to produce a real duo/rival for `computeH2H`. */
export function h2hMatchRow(overrides: Partial<MapMatchRow> = {}): MapMatchRow {
  return {
    match_id: 1,
    match_number: 1,
    week_number: 1,
    season_id: 1,
    season_number: 1,
    season_name: 'Season 1',
    is_gauntlet: false,
    is_playoff_game: false,
    final_score: '13-9',
    shirts_stats: [],
    skins_stats: [],
    picked_map: null,
    shirts_pick: null,
    skins_starting_side: null,
    shirts_ban: null,
    shirts_ban2: null,
    skins_ban1: null,
    skins_ban2: null,
    map_pool: null,
    ...overrides,
  };
}
