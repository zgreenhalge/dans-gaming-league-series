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
}

export interface Week {
  id: number;
  season_id: number;
  week_number: number;
  bye_player_id: number | null;
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
  is_interpolated: boolean;
  notes: string | null;
  scheduled_at: string | null;
  screenshot_url_front: string | null;
  screenshot_url_back: string | null;
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
  player_id: number;
  steam_avatar_url?: string | null;
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
