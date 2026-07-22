/**
 * Shared, internally-consistent fixture "league" for the queries.ts regression harness. One graph
 * spans all 14 tables/views so cross-function calls (`getPlayersById()` alone feeds ~17 other
 * exported functions) stay consistent without re-deriving IDs per test file.
 *
 * Covers the edge cases queries.ts's own code/docs call out as load-bearing:
 * - a paired regular+gauntlet season (id 1 + 2, "Season 5" / "Season 5 Gauntlet") and an orphan
 *   gauntlet with no regular-season pairing (id 4, "Season 4 Gauntlet")
 * - a played match, an unplayed-but-scheduled match (pre-veto, zero-stat pre-staged roster rows),
 *   and an S3-style pre-staged `"0-0"` match — both of the latter two must be excluded by
 *   `isPlayedScore()`, the single most load-bearing edge case per `CLAUDE.md`
 * - gauntlet (`is_playoff_game=true`) matches, including one in the orphan gauntlet
 * - players with full EHOG rating history, a `seed_ehog`-only fallback, and neither (brand new)
 * - maps with and without radar calibration
 * - background jobs across pipelines/statuses (deliberately none in `parsed`/`quarantined`
 *   `demo_ingest` status, since that path also reads R2, which this harness doesn't fake)
 * - ops-errors across all three entity types
 */

import type { FakeDb, Row } from './fakeSupabase';

// ─── Seasons ───────────────────────────────────────────────────────────────

export const SEASONS: Row[] = [
  { id: 1, name: 'Season 5', status: 'COMPLETED', target_win_rounds: 13, buy_in_amount: 20, is_gauntlet: false, start_date: '2026-01-01', map_pool: ['Foroglio', 'Cobblestone', 'Vertigo'] },
  { id: 2, name: 'Season 5 Gauntlet', status: 'COMPLETED', target_win_rounds: 13, buy_in_amount: null, is_gauntlet: true, start_date: '2026-03-01', map_pool: null },
  { id: 3, name: 'Season 6', status: 'ACTIVE', target_win_rounds: 13, buy_in_amount: 20, is_gauntlet: false, start_date: '2026-04-01', map_pool: ['Foroglio'] },
  // Orphan gauntlet — no paired "Season 4" regular season exists in this fixture.
  { id: 4, name: 'Season 4 Gauntlet', status: 'COMPLETED', target_win_rounds: 13, buy_in_amount: null, is_gauntlet: true, start_date: '2025-11-01', map_pool: null },
];

// ─── Weeks ─────────────────────────────────────────────────────────────────

export const WEEKS: Row[] = [
  { id: 10, season_id: 1, week_number: 1, bye_player_id: null },
  { id: 11, season_id: 1, week_number: 2, bye_player_id: 5 },
  { id: 12, season_id: 2, week_number: 1, bye_player_id: null },
  { id: 13, season_id: 3, week_number: 1, bye_player_id: null },
  { id: 14, season_id: 4, week_number: 1, bye_player_id: null },
];

// ─── Players ───────────────────────────────────────────────────────────────
// 1-5: normal players with full EHOG history. 6: seed_ehog-only fallback (no rating_history rows).
// 7-8: brand new — neither history nor seed_ehog, exercises the global-default fallback.

export const PLAYERS: Row[] = [
  { id: 1, name: 'Alice', discord_id: null, steam_id: '76500000000000001', steam_nickname: 'alice_cs', steam_avatar_url: null, steam_refreshed_at: null, is_admin: true, seed_ehog: null },
  { id: 2, name: 'Bob', discord_id: null, steam_id: '76500000000000002', steam_nickname: null, steam_avatar_url: null, steam_refreshed_at: null, is_admin: false, seed_ehog: null },
  { id: 3, name: 'Carol', discord_id: null, steam_id: null, steam_nickname: null, steam_avatar_url: null, steam_refreshed_at: null, is_admin: false, seed_ehog: null },
  { id: 4, name: 'Dave', discord_id: null, steam_id: null, steam_nickname: null, steam_avatar_url: null, steam_refreshed_at: null, is_admin: false, seed_ehog: null },
  { id: 5, name: 'Erin', discord_id: null, steam_id: null, steam_nickname: null, steam_avatar_url: null, steam_refreshed_at: null, is_admin: false, seed_ehog: null },
  { id: 6, name: 'Frank', discord_id: null, steam_id: null, steam_nickname: null, steam_avatar_url: null, steam_refreshed_at: null, is_admin: false, seed_ehog: 1250 },
  { id: 7, name: 'Grace', discord_id: null, steam_id: null, steam_nickname: null, steam_avatar_url: null, steam_refreshed_at: null, is_admin: false, seed_ehog: null },
  { id: 8, name: 'Heidi', discord_id: null, steam_id: null, steam_nickname: null, steam_avatar_url: null, steam_refreshed_at: null, is_admin: false, seed_ehog: null },
];

// ─── Matches ───────────────────────────────────────────────────────────────
// 100: played, regular season.
// 101: unplayed + scheduled, pre-veto (no picks/bans yet) — for getOtherScheduledMatches.
// 102: S3-style pre-staged "0-0" — must be excluded by isPlayedScore().
// 200: played gauntlet match (is_playoff_game=true), paired season.
// 300: played gauntlet match in the orphan gauntlet.
// 400: unplayed, unscheduled, active-season roster placeholder (zero-stat rostered rows).

export const MATCHES: Row[] = [
  {
    id: 100, week_id: 10, match_number: 1, final_score: '13-9',
    picked_map: 'Foroglio', shirts_ban: 'Vertigo', shirts_ban2: 'Nuke', skins_ban1: 'Inferno', skins_ban2: 'Overpass',
    shirts_pick: 'Foroglio', skins_starting_side: 'CT', is_playoff_game: false, is_feature_match: false, is_interpolated: false,
    pre_match_win_prob: 0.55, pre_match_win_prob_formula_version: 'ehog_v1', notes: null, scheduled_at: null,
    screenshot_url_front: null, screenshot_url_back: null, round_history: null, recording_url: null,
    replay_status: 'ready',
  },
  {
    id: 101, week_id: 10, match_number: 2, final_score: null,
    picked_map: null, shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null,
    shirts_pick: null, skins_starting_side: null, is_playoff_game: false, is_feature_match: false, is_interpolated: false,
    pre_match_win_prob: null, pre_match_win_prob_formula_version: null, notes: null, scheduled_at: '2026-01-15T19:00:00.000Z',
    screenshot_url_front: null, screenshot_url_back: null, round_history: null, recording_url: null,
    replay_status: 'none',
  },
  {
    id: 102, week_id: 11, match_number: 1, final_score: '0-0',
    picked_map: 'Cobblestone', shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null,
    shirts_pick: 'Cobblestone', skins_starting_side: null, is_playoff_game: false, is_feature_match: false, is_interpolated: false,
    pre_match_win_prob: null, pre_match_win_prob_formula_version: null, notes: null, scheduled_at: null,
    screenshot_url_front: null, screenshot_url_back: null, round_history: null, recording_url: null,
    replay_status: 'none',
  },
  {
    id: 200, week_id: 12, match_number: 1, final_score: '13-11',
    picked_map: 'Foroglio', shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null,
    shirts_pick: 'Foroglio', skins_starting_side: 'T', is_playoff_game: true, is_feature_match: false, is_interpolated: false,
    pre_match_win_prob: null, pre_match_win_prob_formula_version: null, notes: null, scheduled_at: null,
    screenshot_url_front: null, screenshot_url_back: null, round_history: null, recording_url: null,
    replay_status: 'ready',
  },
  {
    id: 300, week_id: 14, match_number: 1, final_score: '13-5',
    picked_map: 'Vertigo', shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null,
    shirts_pick: 'Vertigo', skins_starting_side: 'CT', is_playoff_game: true, is_feature_match: false, is_interpolated: false,
    pre_match_win_prob: null, pre_match_win_prob_formula_version: null, notes: null, scheduled_at: null,
    screenshot_url_front: null, screenshot_url_back: null, round_history: null, recording_url: null,
    replay_status: 'ready',
  },
  {
    id: 400, week_id: 13, match_number: 1, final_score: null,
    picked_map: null, shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null,
    shirts_pick: null, skins_starting_side: null, is_playoff_game: false, is_feature_match: false, is_interpolated: false,
    pre_match_win_prob: null, pre_match_win_prob_formula_version: null, notes: null, scheduled_at: null,
    screenshot_url_front: null, screenshot_url_back: null, round_history: null, recording_url: null,
    replay_status: 'none',
  },
];

// ─── player_match_stats ─────────────────────────────────────────────────────

function stat(overrides: Partial<Row> & { id: number; match_id: number; player_id: number; faction: 'SHIRTS' | 'SKINS' }): Row {
  return {
    kills: 0, assists: 0, deaths: 0, adr: 0, damage: 0, rounds_played: 0, rounds_won: 0, is_win: false,
    ...overrides,
  };
}

export const PLAYER_MATCH_STATS: Row[] = [
  // Match 100 (played, 22 rounds, shirts win 13-9)
  stat({ id: 1000, match_id: 100, player_id: 1, faction: 'SHIRTS', kills: 20, assists: 3, deaths: 15, adr: 85.5, damage: 1881, rounds_played: 22, rounds_won: 13, is_win: true }),
  stat({ id: 1001, match_id: 100, player_id: 2, faction: 'SHIRTS', kills: 18, assists: 5, deaths: 16, adr: 78.18, damage: 1720, rounds_played: 22, rounds_won: 13, is_win: true }),
  stat({ id: 1002, match_id: 100, player_id: 3, faction: 'SKINS', kills: 14, assists: 4, deaths: 19, adr: 65.0, damage: 1430, rounds_played: 22, rounds_won: 9, is_win: false }),
  stat({ id: 1003, match_id: 100, player_id: 4, faction: 'SKINS', kills: 12, assists: 6, deaths: 20, adr: 60.09, damage: 1322, rounds_played: 22, rounds_won: 9, is_win: false }),

  // Match 101 (unplayed, pre-staged roster — zero stats)
  stat({ id: 1004, match_id: 101, player_id: 5, faction: 'SHIRTS' }),
  stat({ id: 1005, match_id: 101, player_id: 6, faction: 'SHIRTS' }),
  stat({ id: 1006, match_id: 101, player_id: 7, faction: 'SKINS' }),
  stat({ id: 1007, match_id: 101, player_id: 8, faction: 'SKINS' }),

  // Match 102 (S3-style pre-staged "0-0" — zero stats)
  stat({ id: 1008, match_id: 102, player_id: 1, faction: 'SHIRTS' }),
  stat({ id: 1009, match_id: 102, player_id: 3, faction: 'SHIRTS' }),
  stat({ id: 1010, match_id: 102, player_id: 2, faction: 'SKINS' }),
  stat({ id: 1011, match_id: 102, player_id: 4, faction: 'SKINS' }),

  // Match 200 (gauntlet, played, 24 rounds, shirts win 13-11)
  stat({ id: 1012, match_id: 200, player_id: 1, faction: 'SHIRTS', kills: 22, assists: 2, deaths: 18, adr: 88.0, damage: 2112, rounds_played: 24, rounds_won: 13, is_win: true }),
  stat({ id: 1013, match_id: 200, player_id: 2, faction: 'SHIRTS', kills: 19, assists: 4, deaths: 19, adr: 80.0, damage: 1920, rounds_played: 24, rounds_won: 13, is_win: true }),
  stat({ id: 1014, match_id: 200, player_id: 5, faction: 'SKINS', kills: 17, assists: 3, deaths: 21, adr: 70.0, damage: 1680, rounds_played: 24, rounds_won: 11, is_win: false }),
  stat({ id: 1015, match_id: 200, player_id: 6, faction: 'SKINS', kills: 15, assists: 5, deaths: 22, adr: 65.0, damage: 1560, rounds_played: 24, rounds_won: 11, is_win: false }),

  // Match 300 (orphan gauntlet, played, 18 rounds, shirts win 13-5)
  stat({ id: 1016, match_id: 300, player_id: 3, faction: 'SHIRTS', kills: 16, assists: 1, deaths: 10, adr: 95.0, damage: 1710, rounds_played: 18, rounds_won: 13, is_win: true }),
  stat({ id: 1017, match_id: 300, player_id: 4, faction: 'SHIRTS', kills: 14, assists: 3, deaths: 11, adr: 88.0, damage: 1584, rounds_played: 18, rounds_won: 13, is_win: true }),
  stat({ id: 1018, match_id: 300, player_id: 7, faction: 'SKINS', kills: 8, assists: 2, deaths: 16, adr: 45.0, damage: 810, rounds_played: 18, rounds_won: 5, is_win: false }),
  stat({ id: 1019, match_id: 300, player_id: 8, faction: 'SKINS', kills: 7, assists: 1, deaths: 17, adr: 40.0, damage: 720, rounds_played: 18, rounds_won: 5, is_win: false }),

  // Match 400 (unplayed, unscheduled, active-season roster placeholder — zero stats)
  stat({ id: 1020, match_id: 400, player_id: 1, faction: 'SHIRTS' }),
  stat({ id: 1021, match_id: 400, player_id: 5, faction: 'SHIRTS' }),
  stat({ id: 1022, match_id: 400, player_id: 6, faction: 'SKINS' }),
  stat({ id: 1023, match_id: 400, player_id: 7, faction: 'SKINS' }),
];

// ─── player_match_sabremetrics ──────────────────────────────────────────────
// One row per played (non-zero) player_match_stats row above (ids 1000-1003, 1012-1015, 1016-1019).

function sab(overrides: Partial<Row> & { player_match_stats_id: number }): Row {
  return {
    kills_ct: 0, kills_t: 0, deaths_ct: 0, deaths_t: 0, assists_ct: 0, assists_t: 0, damage_ct: 0, damage_t: 0,
    headshot_kills: 0, headshot_kills_ct: 0, headshot_kills_t: 0, opening_kills: 0, opening_deaths: 0,
    kast_rounds: 0, clutch_1v1_attempts: 0, clutch_1v1_wins: 0, clutch_1v2_attempts: 0, clutch_1v2_wins: 0,
    clutch_2v1_attempts: 0, clutch_2v1_wins: 0, teamkills: 0,
    flash_assists: 0, flashes_leading_to_kill: 0, utility_damage: 0, blind_duration_dealt: 0, enemies_flashed: 0,
    flashes_thrown: 0, teamflash_duration: 0, plants: 0, defuses: 0, two_k_rounds: 0,
    trade_kill_opportunities: 0, trade_kill_attempts: 0, trade_kill_successes: 0,
    traded_death_opportunities: 0, traded_death_attempts: 0, traded_death_successes: 0,
    he_thrown: 0, he_damage: 0, blind_duration_max_sum: 0, effective_flashes: 0,
    shots_fired: 0, shots_hit: 0, headshot_hits: 0, shots_hit_no_awp: 0, headshot_hits_no_awp: 0,
    counter_strafe_shots: 0, counter_strafe_good_shots: 0,
    spray_shots_fired: 0, spray_shots_hit: 0, smokes_blocking_push: 0, ct_smokes_thrown: 0,
    unused_util_value_on_death_total: 0,
    ...overrides,
  };
}

export const PLAYER_MATCH_SABREMETRICS: Row[] = [
  sab({ player_match_stats_id: 1000, kills_ct: 11, kills_t: 9, deaths_ct: 7, deaths_t: 8, assists_ct: 2, assists_t: 1, damage_ct: 1020, damage_t: 861, headshot_kills: 9, opening_kills: 4, opening_deaths: 1, kast_rounds: 17, clutch_1v1_attempts: 2, clutch_1v1_wins: 1, flash_assists: 2, enemies_flashed: 6, flashes_thrown: 8, plants: 3, trade_kill_opportunities: 5, trade_kill_attempts: 4, trade_kill_successes: 3, shots_fired: 140, shots_hit: 60, headshot_hits: 25 }),
  sab({ player_match_stats_id: 1001, kills_ct: 10, kills_t: 8, deaths_ct: 8, deaths_t: 8, assists_ct: 3, assists_t: 2, damage_ct: 940, damage_t: 780, headshot_kills: 6, opening_kills: 2, opening_deaths: 2, kast_rounds: 15, flash_assists: 3, enemies_flashed: 7, flashes_thrown: 9, defuses: 1, trade_kill_opportunities: 4, trade_kill_attempts: 3, trade_kill_successes: 2, shots_fired: 130, shots_hit: 50, headshot_hits: 18 }),
  sab({ player_match_stats_id: 1002, kills_ct: 7, kills_t: 7, deaths_ct: 10, deaths_t: 9, assists_ct: 2, assists_t: 2, damage_ct: 720, damage_t: 710, headshot_kills: 5, opening_kills: 1, opening_deaths: 3, kast_rounds: 12, flash_assists: 1, enemies_flashed: 4, flashes_thrown: 5, trade_kill_opportunities: 3, trade_kill_attempts: 2, trade_kill_successes: 1, shots_fired: 110, shots_hit: 38, headshot_hits: 12, teamkills: 1 }),
  sab({ player_match_stats_id: 1003, kills_ct: 6, kills_t: 6, deaths_ct: 11, deaths_t: 9, assists_ct: 3, assists_t: 3, damage_ct: 670, damage_t: 652, headshot_kills: 4, opening_kills: 1, opening_deaths: 2, kast_rounds: 11, flash_assists: 2, enemies_flashed: 5, flashes_thrown: 6, trade_kill_opportunities: 3, trade_kill_attempts: 2, trade_kill_successes: 1, shots_fired: 105, shots_hit: 33, headshot_hits: 9 }),

  sab({ player_match_stats_id: 1012, kills_ct: 12, kills_t: 10, deaths_ct: 9, deaths_t: 9, assists_ct: 1, assists_t: 1, damage_ct: 1150, damage_t: 962, headshot_kills: 10, opening_kills: 5, opening_deaths: 1, kast_rounds: 19, clutch_1v2_attempts: 1, clutch_1v2_wins: 1, flash_assists: 1, enemies_flashed: 5, flashes_thrown: 7, plants: 2, trade_kill_opportunities: 6, trade_kill_attempts: 5, trade_kill_successes: 4, shots_fired: 150, shots_hit: 65, headshot_hits: 28 }),
  sab({ player_match_stats_id: 1013, kills_ct: 10, kills_t: 9, deaths_ct: 9, deaths_t: 10, assists_ct: 2, assists_t: 2, damage_ct: 1000, damage_t: 920, headshot_kills: 7, opening_kills: 2, opening_deaths: 2, kast_rounds: 17, flash_assists: 3, enemies_flashed: 6, flashes_thrown: 8, defuses: 1, trade_kill_opportunities: 5, trade_kill_attempts: 4, trade_kill_successes: 3, shots_fired: 138, shots_hit: 54, headshot_hits: 19 }),
  sab({ player_match_stats_id: 1014, kills_ct: 9, kills_t: 8, deaths_ct: 11, deaths_t: 10, assists_ct: 2, assists_t: 1, damage_ct: 880, damage_t: 800, headshot_kills: 6, opening_kills: 1, opening_deaths: 3, kast_rounds: 14, flash_assists: 1, enemies_flashed: 4, flashes_thrown: 5, trade_kill_opportunities: 4, trade_kill_attempts: 3, trade_kill_successes: 2, shots_fired: 125, shots_hit: 42, headshot_hits: 13 }),
  sab({ player_match_stats_id: 1015, kills_ct: 8, kills_t: 7, deaths_ct: 12, deaths_t: 10, assists_ct: 3, assists_t: 2, damage_ct: 820, damage_t: 740, headshot_kills: 5, opening_kills: 1, opening_deaths: 2, kast_rounds: 12, flash_assists: 2, enemies_flashed: 5, flashes_thrown: 6, trade_kill_opportunities: 3, trade_kill_attempts: 2, trade_kill_successes: 1, shots_fired: 118, shots_hit: 36, headshot_hits: 10 }),

  sab({ player_match_stats_id: 1016, kills_ct: 9, kills_t: 7, deaths_ct: 5, deaths_t: 5, assists_ct: 1, assists_t: 0, damage_ct: 900, damage_t: 810, headshot_kills: 8, opening_kills: 4, opening_deaths: 0, kast_rounds: 15, clutch_1v1_attempts: 1, clutch_1v1_wins: 1, flash_assists: 1, enemies_flashed: 3, flashes_thrown: 4, plants: 2, trade_kill_opportunities: 4, trade_kill_attempts: 4, trade_kill_successes: 3, shots_fired: 100, shots_hit: 48, headshot_hits: 22 }),
  sab({ player_match_stats_id: 1017, kills_ct: 8, kills_t: 6, deaths_ct: 6, deaths_t: 5, assists_ct: 2, assists_t: 1, damage_ct: 820, damage_t: 764, headshot_kills: 6, opening_kills: 2, opening_deaths: 1, kast_rounds: 13, flash_assists: 2, enemies_flashed: 4, flashes_thrown: 5, defuses: 1, trade_kill_opportunities: 3, trade_kill_attempts: 3, trade_kill_successes: 2, shots_fired: 92, shots_hit: 39, headshot_hits: 15 }),
  sab({ player_match_stats_id: 1018, kills_ct: 4, kills_t: 4, deaths_ct: 8, deaths_t: 8, assists_ct: 1, assists_t: 1, damage_ct: 400, damage_t: 410, headshot_kills: 2, opening_kills: 0, opening_deaths: 2, kast_rounds: 6, trade_kill_opportunities: 2, trade_kill_attempts: 1, trade_kill_successes: 0, shots_fired: 80, shots_hit: 20, headshot_hits: 5 }),
  sab({ player_match_stats_id: 1019, kills_ct: 3, kills_t: 4, deaths_ct: 9, deaths_t: 8, assists_ct: 1, assists_t: 0, damage_ct: 350, damage_t: 370, headshot_kills: 2, opening_kills: 0, opening_deaths: 1, kast_rounds: 5, trade_kill_opportunities: 2, trade_kill_attempts: 1, trade_kill_successes: 0, shots_fired: 75, shots_hit: 18, headshot_hits: 4 }),
];

// ─── player_season_leaderboard (a materialized VIEW — hand-authored, consistent with the
//     underlying non-playoff played matches above, i.e. match 100 only; gauntlet matches (200, 300)
//     are excluded, matching the real view's `is_playoff_game=true` filter) ──────────────────────

export const PLAYER_SEASON_LEADERBOARD: Row[] = [
  { season_id: 1, player_id: 1, player_name: 'Alice', matches_played: 1, matches_won: 1, matches_lost: 0, win_rate_percentage: 100, total_kills: 20, total_deaths: 15, kd_ratio: 20 / 15, total_damage: 1881, total_rounds_played: 22, overall_adr: 1881 / 22 },
  { season_id: 1, player_id: 2, player_name: 'Bob', matches_played: 1, matches_won: 1, matches_lost: 0, win_rate_percentage: 100, total_kills: 18, total_deaths: 16, kd_ratio: 18 / 16, total_damage: 1720, total_rounds_played: 22, overall_adr: 1720 / 22 },
  { season_id: 1, player_id: 3, player_name: 'Carol', matches_played: 1, matches_won: 0, matches_lost: 1, win_rate_percentage: 0, total_kills: 14, total_deaths: 19, kd_ratio: 14 / 19, total_damage: 1430, total_rounds_played: 22, overall_adr: 1430 / 22 },
  { season_id: 1, player_id: 4, player_name: 'Dave', matches_played: 1, matches_won: 0, matches_lost: 1, win_rate_percentage: 0, total_kills: 12, total_deaths: 20, kd_ratio: 12 / 20, total_damage: 1322, total_rounds_played: 22, overall_adr: 1322 / 22 },
];

// ─── maps ────────────────────────────────────────────────────────────────

export const MAPS: Row[] = [
  { id: 1, name: 'Foroglio', slug: 'foroglio', workshop_url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=100001', image_url: '/maps/foroglio.jpg', radar_pos_x: -1000, radar_pos_y: 2000, radar_scale: 4.5, radar_image_url: '/radar/foroglio.png', radar_source: 'manual' },
  { id: 2, name: 'Vertigo', slug: 'vertigo', workshop_url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=100002', image_url: '/maps/vertigo.jpg', radar_pos_x: null, radar_pos_y: null, radar_scale: null, radar_image_url: null, radar_source: null },
  { id: 3, name: 'Cobblestone', slug: 'cobblestone', workshop_url: null, image_url: null, radar_pos_x: null, radar_pos_y: null, radar_scale: null, radar_image_url: null, radar_source: null },
];

// ─── gauntlet_pods / gauntlet_pod_slots ─────────────────────────────────────

export const GAUNTLET_PODS: Row[] = [
  { id: 1000, season_id: 2, round_number: 1, pod_index: 0, advance_rule: 'single', is_final: true, week_id: 12, match1_id: 200, match2_id: null },
  { id: 1001, season_id: 4, round_number: 1, pod_index: 0, advance_rule: 'single', is_final: true, week_id: 14, match1_id: 300, match2_id: null },
];

export const GAUNTLET_POD_SLOTS: Row[] = [
  { pod_id: 1000, slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: 1 },
  { pod_id: 1000, slot_index: 1, source_kind: 'seed', source_seed: 2, source_pod_id: null, player_id: 2 },
  { pod_id: 1000, slot_index: 2, source_kind: 'seed', source_seed: 3, source_pod_id: null, player_id: 5 },
  { pod_id: 1000, slot_index: 3, source_kind: 'pod', source_seed: null, source_pod_id: 999, player_id: 6 },
  { pod_id: 1001, slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: 3 },
  { pod_id: 1001, slot_index: 1, source_kind: 'seed', source_seed: 2, source_pod_id: null, player_id: 4 },
  { pod_id: 1001, slot_index: 2, source_kind: 'seed', source_seed: 3, source_pod_id: null, player_id: 7 },
  { pod_id: 1001, slot_index: 3, source_kind: 'seed', source_seed: 4, source_pod_id: null, player_id: 8 },
];

// ─── background_jobs ─────────────────────────────────────────────────────
// Deliberately no demo_ingest row in 'parsed'/'quarantined' status — that path also reads R2,
// which this harness doesn't fake. Every other status/pipeline combination is covered.

export const BACKGROUND_JOBS: Row[] = [
  { job_type: 'demo_ingest', match_id: 100, map_id: null, status: 'succeeded', stage: null, error_message: null, gh_run_url: 'https://github.com/example/actions/runs/1', created_at: '2026-01-05T00:00:00.000Z', updated_at: '2026-01-05T00:05:00.000Z', started_at: '2026-01-05T00:01:00.000Z', finished_at: '2026-01-05T00:05:00.000Z' },
  { job_type: 'replay_extract', match_id: 100, map_id: null, status: 'succeeded', stage: null, error_message: null, gh_run_url: 'https://github.com/example/actions/runs/2', created_at: '2026-01-05T00:06:00.000Z', updated_at: '2026-01-05T00:10:00.000Z', started_at: '2026-01-05T00:07:00.000Z', finished_at: '2026-01-05T00:10:00.000Z' },
  { job_type: 'replay_extract', match_id: 200, map_id: null, status: 'failed', stage: 'parse', error_message: 'ffmpeg exited 1', gh_run_url: null, created_at: '2026-03-02T00:00:00.000Z', updated_at: '2026-03-02T00:02:00.000Z', started_at: '2026-03-02T00:01:00.000Z', finished_at: null },
  { job_type: 'radar_build', match_id: null, map_id: 1, status: 'succeeded', stage: null, error_message: null, gh_run_url: 'https://github.com/example/actions/runs/3', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:03:00.000Z', started_at: '2026-01-01T00:01:00.000Z', finished_at: '2026-01-01T00:03:00.000Z' },
  { job_type: 'radar_build', match_id: null, map_id: 2, status: 'running', stage: 'calibrating', error_message: null, gh_run_url: null, created_at: '2026-04-01T00:00:00.000Z', updated_at: '2026-04-01T00:01:00.000Z', started_at: '2026-04-01T00:01:00.000Z', finished_at: null },
];

// ─── ops_errors ────────────────────────────────────────────────────────────

export const OPS_ERRORS: Row[] = [
  { id: 1, entity_type: 'season', entity_id: 1, operation: 'gauntlet_auto_seed', message: 'Could not seed pod 3: ambiguous tiebreak', occurred_at: '2026-02-01T00:00:00.000Z' },
  { id: 2, entity_type: 'match', entity_id: 100, operation: 'steam_id_learn', message: 'Player Bob has no linked steam_id', occurred_at: '2026-01-10T00:00:00.000Z' },
  { id: 3, entity_type: 'system', entity_id: 0, operation: 'ehog_recompute', message: 'Recompute failed: timeout', occurred_at: '2026-03-01T00:00:00.000Z' },
];

// ─── player_current_ratings / player_rating_history ─────────────────────────
// Players 1-5 have both a current rating and history. Player 6 (Frank) has neither — his
// seed_ehog fallback is exercised instead. Players 7-8 have neither history nor seed_ehog.

export const PLAYER_CURRENT_RATINGS: Row[] = [
  { player_id: 1, ehog_v1: 1450 },
  { player_id: 2, ehog_v1: 1380 },
  { player_id: 3, ehog_v1: 1290 },
  { player_id: 4, ehog_v1: 1310 },
  { player_id: 5, ehog_v1: 1200 },
];

export const PLAYER_RATING_HISTORY: Row[] = [
  { player_id: 1, match_id: 100, sequence_index: 1, ehog_rating: 1420, rating_delta: 20, formula_version: 'ehog_v1', mu: 26.5, sigma: 7.2 },
  { player_id: 1, match_id: 200, sequence_index: 2, ehog_rating: 1450, rating_delta: 30, formula_version: 'ehog_v1', mu: 27.0, sigma: 6.8 },
  { player_id: 2, match_id: 100, sequence_index: 1, ehog_rating: 1360, rating_delta: 15, formula_version: 'ehog_v1', mu: 25.0, sigma: 7.5 },
  { player_id: 2, match_id: 200, sequence_index: 2, ehog_rating: 1380, rating_delta: 20, formula_version: 'ehog_v1', mu: 25.3, sigma: 7.1 },
  { player_id: 3, match_id: 100, sequence_index: 1, ehog_rating: 1300, rating_delta: -10, formula_version: 'ehog_v1', mu: 23.8, sigma: 7.6 },
  { player_id: 3, match_id: 300, sequence_index: 2, ehog_rating: 1290, rating_delta: -10, formula_version: 'ehog_v1', mu: 23.6, sigma: 7.4 },
  { player_id: 4, match_id: 100, sequence_index: 1, ehog_rating: 1320, rating_delta: -8, formula_version: 'ehog_v1', mu: 24.0, sigma: 7.5 },
  { player_id: 4, match_id: 300, sequence_index: 2, ehog_rating: 1310, rating_delta: -10, formula_version: 'ehog_v1', mu: 23.9, sigma: 7.3 },
  { player_id: 5, match_id: 200, sequence_index: 1, ehog_rating: 1200, rating_delta: -25, formula_version: 'ehog_v1', mu: 22.5, sigma: 7.8 },
];

// ─── Pagination-boundary filler ─────────────────────────────────────────────
// >1000 matches with a week_id that resolves to no fixture season, so every season/career
// aggregation silently (and correctly) skips them — they exist purely to push fetchAllPages()
// across a real 1000-row PostgREST page boundary. Deliberately isolated: nothing in the narrative
// fixtures above references week_id 99999.

const PAGINATION_FILLER_MATCHES: Row[] = Array.from({ length: 1250 }, (_, i) => ({
  id: 90000 + i,
  week_id: 99999,
  match_number: 1,
  final_score: i % 2 === 0 ? '13-9' : null,
  picked_map: 'Filler Map',
  shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null, shirts_pick: 'Filler Map',
  skins_starting_side: null, is_playoff_game: false, is_feature_match: false, is_interpolated: false,
  pre_match_win_prob: null, pre_match_win_prob_formula_version: null, notes: null, scheduled_at: null,
  screenshot_url_front: null, screenshot_url_back: null, round_history: null, recording_url: null,
  replay_status: 'none',
}));

// ─── Assembly ────────────────────────────────────────────────────────────

export function buildFakeDb(): FakeDb {
  return {
    seasons: SEASONS,
    weeks: WEEKS,
    matches: [...MATCHES, ...PAGINATION_FILLER_MATCHES],
    players: PLAYERS,
    player_match_stats: PLAYER_MATCH_STATS,
    player_match_sabremetrics: PLAYER_MATCH_SABREMETRICS,
    player_season_leaderboard: PLAYER_SEASON_LEADERBOARD,
    maps: MAPS,
    gauntlet_pods: GAUNTLET_PODS,
    gauntlet_pod_slots: GAUNTLET_POD_SLOTS,
    background_jobs: BACKGROUND_JOBS,
    ops_errors: OPS_ERRORS,
    player_current_ratings: PLAYER_CURRENT_RATINGS,
    player_rating_history: PLAYER_RATING_HISTORY,
  };
}
