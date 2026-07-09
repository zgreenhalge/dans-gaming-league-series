export type SeasonStatus = 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
export type Faction = 'SHIRTS' | 'SKINS';

export interface Season {
  id: number;
  name: string;
  status: SeasonStatus;
  target_win_rounds: number;
  buy_in_amount: number | null;
  is_gauntlet: boolean;
  start_date: string | null;
  map_pool: string[] | null;
  /** Set when a best-effort gauntlet operation (auto-build, auto-seed, auto-archive) fails —
   * cleared on the next successful attempt at that same operation. Null in the common case. */
  ops_error: string | null;
  ops_error_at: string | null;
}

export interface Week {
  id: number;
  season_id: number;
  week_number: number;
  bye_player_id: number | null;
}

/** How a single round was won. Drives the round-history strip icon. */
export type RoundCondition = 'elim' | 'bomb' | 'defuse' | 'time';

/** One round's outcome, for the CS2-scoreboard-style round-history strip. */
export interface RoundHistoryEntry {
  n: number;                  // 1-based round number
  winner: 'SHIRTS' | 'SKINS'; // winning team (drives vertical track)
  side: 'CT' | 'T';           // winning side (drives tile color)
  condition: RoundCondition;  // how the round was won (drives icon)
}

export interface Match {
  id: number;
  week_id: number;
  match_number: number;
  final_score: string | null;
  picked_map: string | null;
  shirts_ban: string | null;
  shirts_ban2: string | null;
  skins_ban1: string | null;
  skins_ban2: string | null;
  shirts_pick: string | null;
  skins_starting_side: 'CT' | 'T' | null;
  is_playoff_game: boolean;
  is_feature_match: boolean;
  is_interpolated: boolean;
  notes: string | null;
  scheduled_at: string | null;
  screenshot_url_front: string | null;
  screenshot_url_back: string | null;
  round_history: RoundHistoryEntry[] | null;
  recording_url: string | null;
}

export interface Player {
  id: number;
  name: string;
  discord_id: string | null;
  steam_id: string | null;
  steam_nickname: string | null;
  steam_avatar_url: string | null;
  steam_refreshed_at: string | null;
  is_admin: boolean;
}

export interface PlayerMatchStat {
  id: number;
  match_id: number;
  player_id: number;
  faction: Faction;
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  damage: number;
  rounds_played: number;
  rounds_won: number;
  is_win: boolean;
}

export interface LeaderboardRow {
  season_id: number;
  player_id: number;
  player_name: string;
  matches_played: number;
  matches_won: number;
  matches_lost: number;
  win_rate_percentage: number;
  total_kills: number;
  total_assists: number;    // not in DB view — augmented from player_match_stats
  total_deaths: number;
  kd_ratio: number;
  total_damage: number;
  total_rounds_played: number;
  total_rounds_won: number; // not in DB view — augmented from player_match_stats
  rwr_percentage: number;   // derived: total_rounds_won / total_rounds_played * 100
  overall_adr: number;
}

export interface LeaderboardRowWithId extends LeaderboardRow {
  steam_avatar_url?: string | null;
  kills_in_wins: number;
  deaths_in_wins: number;
  kills_in_losses: number;
  deaths_in_losses: number;
}

export interface MapSeasonStat {
  seasonId: number;
  isGauntlet: boolean;
  pickCount: number;
  banCount: number;
  noPickCount: number;
  totalKills: number;
  totalAssists: number;
  pickAndWon: number;
}

export interface MapIndexEntry {
  name: string;
  slug: string;
  pickCount: number;
  banCount: number;
  noPickCount: number;
  seasons: { id: number; name: string; is_gauntlet: boolean }[];
  statsBySeason: MapSeasonStat[];
}

export interface PlayerMatchSabremetrics {
  player_match_stats_id: number;
  kills_ct: number;
  kills_t: number;
  deaths_ct: number;
  deaths_t: number;
  assists_ct: number;
  assists_t: number;
  damage_ct: number;
  damage_t: number;
  headshot_kills: number;
  headshot_kills_ct: number;
  headshot_kills_t: number;
  opening_kills: number;
  opening_deaths: number;
  kast_rounds: number;
  clutch_1v1_attempts: number;
  clutch_1v1_wins: number;
  clutch_1v2_attempts: number;
  clutch_1v2_wins: number;
  flash_assists: number;
  flashes_leading_to_kill: number;
  utility_damage: number;
  blind_duration_dealt: number;
  enemies_flashed: number;
  flashes_thrown: number;
  teamflash_duration: number;
  plants: number;
  defuses: number;
  two_k_rounds: number;
  trade_kill_opportunities: number;
  trade_kill_attempts: number;
  trade_kill_successes: number;
  traded_death_opportunities: number;
  traded_death_attempts: number;
  traded_death_successes: number;
  he_thrown: number;
  he_damage: number;
  blind_duration_max_sum: number;
  effective_flashes: number;
  shots_fired: number;
  shots_hit: number;
  headshot_hits: number;
  counter_strafe_shots: number;
  counter_strafe_good_shots: number;
  spray_shots_fired: number;
  spray_shots_hit: number;
  smokes_blocking_push: number;
}

export type SabFields = Omit<PlayerMatchSabremetrics, 'player_match_stats_id'>;

export interface DemoSabremetricStat {
  player_id: number;
  sabremetrics: SabFields;
}

export interface ParsedDemoSabremetricsResult {
  sabremetrics: DemoSabremetricStat[];
  warnings: string[];
}
