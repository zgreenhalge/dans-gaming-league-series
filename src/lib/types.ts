export type SeasonStatus = 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
export type Faction = 'SHIRTS' | 'SKINS';

/** A match's 2D-replay job status — gates the Recap tab's 2D Replay/Heatmap/Pathing UI. */
export type ReplayStatus = 'none' | 'queued' | 'running' | 'ready' | 'failed';

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
  pre_match_win_prob: number | null;
  pre_match_win_prob_formula_version: string | null;
  scheduled_at: string | null;
  round_history: RoundHistoryEntry[] | null;
  recording_url: string | null;
  /** Optional because older environments may predate the column (see `docs/replay.md`). */
  replay_status?: ReplayStatus | null;
}

export interface Player {
  id: number;
  name: string;
  discord_id: string | null;
  /** The player's cosmetic name-color Discord role — `null` if unlinked or not yet created. */
  discord_name_role_id: string | null;
  steam_id: string | null;
  steam_nickname: string | null;
  steam_avatar_url: string | null;
  steam_refreshed_at: string | null;
  is_admin: boolean;
  seed_ehog: number | null;
  /** When `name` last changed (either route) — the atomic-conditional-update gate for the
   * self-service rename cooldown; `null` for a player who's never been renamed. */
  name_changed_at: string | null;
}

/** One row per player on a season's roster — explicit since a season with no matches yet has no
 * roster derivable from `player_match_stats`. Unique per `(season_id, player_id)`. */
export interface SeasonPlayer {
  id: number;
  season_id: number;
  player_id: number;
  joined_at: string;
}

/** A regular season's editable matchup draft — mirrors `Week`/`Match` in shape (down to reusing
 * `bye_player_id` singular, since `doubleheaderPolicy: 'auto'` caps byes at one per week by
 * construction) but lives in its own tables until confirmed, so generating or hand-editing it
 * never touches real `weeks`/`matches` rows. See `season-schedule.ts` / `season-schedule-engine.ts`
 * for generation and `season-schedule-draft-engine.ts` for persistence. */
export interface SeasonScheduleDraftWeek {
  id: number;
  season_id: number;
  week_number: number;
  bye_player_id: number | null;
}

export interface SeasonScheduleDraftMatch {
  id: number;
  draft_week_id: number;
  match_number: number;
  shirts_player1_id: number;
  shirts_player2_id: number;
  skins_player1_id: number;
  skins_player2_id: number;
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
  totalRounds: number;
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
  // headshot_kills/teamkills are derived from match_kills at query time (#457), not stored — see
  // deriveHeadshotAndTeamkillCounts() in queries/kills.ts. headshot_kills_ct/_t stay stored for now,
  // pending a match_rounds-based side-resolution helper to derive those too.
  headshot_kills_ct: number;
  headshot_kills_t: number;
  opening_kills: number;
  opening_deaths: number;
  kast_rounds: number;
  clutch_1v1_attempts: number;
  clutch_1v1_wins: number;
  clutch_1v2_attempts: number;
  clutch_1v2_wins: number;
  clutch_2v1_attempts: number;
  clutch_2v1_wins: number;
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
  shots_hit_no_awp: number;
  headshot_hits_no_awp: number;
  counter_strafe_shots: number;
  counter_strafe_good_shots: number;
  spray_shots_fired: number;
  spray_shots_hit: number;
  smokes_blocking_push: number;
  ct_smokes_thrown: number;
  unused_util_value_on_death_total: number;
  rounds_dropped_on_reload_total: number;
  reloads_total: number;
}

export type SabFields = Omit<PlayerMatchSabremetrics, 'player_match_stats_id'>;

/** `SabFields` plus the two fields no longer stored on `player_match_sabremetrics` — derived at
 *  query time from `match_kills` instead (`deriveHeadshotAndTeamkillCounts()` in
 *  `queries/kills.ts`), but still carried alongside every other sabremetric so aggregation/display
 *  code doesn't need a special case for them. */
export type SabFieldsWithDerived = SabFields & { headshot_kills: number; teamkills: number };

export interface DemoSabremetricStat {
  player_id: number;
  sabremetrics: SabFields;
}

// #279: per-player shot/accuracy/damage/rounds breakdown, bucketed either by weapon class
// (pistol/smg/rifle/sniper/shotgun) or by round-economy tier (eco/force_buy/full_buy) — same
// metric shape, two different tables (`player_match_weapon_stats`/`player_match_economy_stats`)
// since a round's economy classification is independent of which weapon fired.
export interface WeaponStatFields {
  shots_fired: number;
  shots_hit: number;
  headshot_hits: number;
  damage_dealt: number;
  rounds_played: number;
}

export interface PlayerMatchWeaponStat extends WeaponStatFields {
  player_match_stats_id: number;
  weapon_category: string;
}

export interface PlayerMatchEconomyStat extends WeaponStatFields {
  player_match_stats_id: number;
  economy_type: string;
}

export interface DemoWeaponStat {
  player_id: number;
  weaponStats: (WeaponStatFields & { weapon_category: string })[];
  economyStats: (WeaponStatFields & { economy_type: string })[];
}

// `match_kills`/`match_rounds`: one row per kill/round event (not a per-player aggregate like
// the stat shapes above) — see docs/architecture.md. Identity is `player_id`, resolved to
// `player_match_stats_id` at persistence time via `resolvePlayerMatchStatsIds()`, matching
// `DemoWeaponStat`'s convention.
export interface DemoMatchKill {
  round_number: number;
  attacker_player_id: number | null;
  victim_player_id: number;
  assister_player_id: number | null;
  weapon: string;
  headshot: boolean;
  noscope: boolean;
  wallbang: boolean;
  blind_kill: boolean;
  midair: boolean;
  is_teamkill: boolean;
  tick: number;
}

export interface DemoMatchRound {
  round_number: number;
  winner_side: 'CT' | 'T';
  shirts_side: 'CT' | 'T';
  win_reason: RoundCondition;
}

// `match_utility_throws`: one row per `player_blind` event — the primitive that makes "which flash
// led to this kill/assist" queryable, not because any single flash is browsable on its own. Self-
// flashes (flasher === blinded) are kept, not filtered — same "downstream queries decide" convention
// `DemoMatchKill` follows for teamkills.
export interface DemoMatchUtilityThrow {
  round_number: number;
  flasher_player_id: number;
  blinded_player_id: number;
  blind_duration: number;
  tick: number;
}

// `match_round_economy`: one row per (round, player) — round-grain, not shot-grain, since
// `economy_type` is seeded from the round's own eco/force/full classification independent of
// whether the player fired a shot that round (see docs/demo-ingestion.md).
export interface DemoMatchRoundEconomy {
  round_number: number;
  player_id: number;
  economy_type: string;
  equipment_value: number;
}

export interface ParsedDemoSabremetricsResult {
  sabremetrics: DemoSabremetricStat[];
  weaponStats: DemoWeaponStat[];
  matchKills: DemoMatchKill[];
  matchRounds: DemoMatchRound[];
  matchUtilityThrows: DemoMatchUtilityThrow[];
  matchRoundEconomy: DemoMatchRoundEconomy[];
  warnings: string[];
}
