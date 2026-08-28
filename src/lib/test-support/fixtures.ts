/**
 * Shared, internally-consistent fixture "league" for the queries.ts regression harness. One graph
 * spans all 16 tables/views so cross-function calls (`getPlayersById()` alone feeds ~17 other
 * exported functions) stay consistent without re-deriving IDs per test file. Also the data
 * `src/lib/dev-fallback-supabase.ts` serves for `npm run build`/`npm run dev` when no Supabase env
 * vars are configured — this is real site content in that path, not just test input.
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
 * - a season schedule draft (Season 6, id 3) and a season with none yet (Season 5, id 1)
 */

import type { FakeDb, Row } from './fakeSupabase';
import { zeroSabFields } from './sabFields';
import type { SabFields } from '../types';

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
  { id: 1, name: 'Alice', discord_id: null, discord_name_role_id: null, steam_id: '76500000000000001', steam_nickname: 'alice_cs', steam_avatar_url: null, steam_refreshed_at: null, is_admin: true, seed_ehog: null, name_changed_at: null },
  { id: 2, name: 'Bob', discord_id: null, discord_name_role_id: null, steam_id: '76500000000000002', steam_nickname: null, steam_avatar_url: null, steam_refreshed_at: null, is_admin: false, seed_ehog: null, name_changed_at: '2026-02-01T00:00:00.000Z' },
  { id: 3, name: 'Carol', discord_id: null, discord_name_role_id: null, steam_id: null, steam_nickname: null, steam_avatar_url: null, steam_refreshed_at: null, is_admin: false, seed_ehog: null, name_changed_at: null },
  { id: 4, name: 'Dave', discord_id: null, discord_name_role_id: null, steam_id: null, steam_nickname: null, steam_avatar_url: null, steam_refreshed_at: null, is_admin: false, seed_ehog: null, name_changed_at: null },
  { id: 5, name: 'Erin', discord_id: null, discord_name_role_id: null, steam_id: null, steam_nickname: null, steam_avatar_url: null, steam_refreshed_at: null, is_admin: false, seed_ehog: null, name_changed_at: null },
  { id: 6, name: 'Frank', discord_id: null, discord_name_role_id: null, steam_id: null, steam_nickname: null, steam_avatar_url: null, steam_refreshed_at: null, is_admin: false, seed_ehog: 1250, name_changed_at: null },
  { id: 7, name: 'Grace', discord_id: null, discord_name_role_id: null, steam_id: null, steam_nickname: null, steam_avatar_url: null, steam_refreshed_at: null, is_admin: false, seed_ehog: null, name_changed_at: null },
  { id: 8, name: 'Heidi', discord_id: null, discord_name_role_id: null, steam_id: null, steam_nickname: null, steam_avatar_url: null, steam_refreshed_at: null, is_admin: false, seed_ehog: null, name_changed_at: null },
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
    shirts_pick: 'Foroglio', skins_starting_side: 'CT', is_playoff_game: false, is_feature_match: false,
    pre_match_win_prob: 0.55, pre_match_win_prob_formula_version: 'ehog_v1', scheduled_at: null,
    round_history: null, recording_url: null,
    replay_status: 'ready',
  },
  {
    id: 101, week_id: 10, match_number: 2, final_score: null,
    picked_map: null, shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null,
    shirts_pick: null, skins_starting_side: null, is_playoff_game: false, is_feature_match: false,
    pre_match_win_prob: null, pre_match_win_prob_formula_version: null, scheduled_at: '2026-01-15T19:00:00.000Z',
    round_history: null, recording_url: null,
    replay_status: 'none',
  },
  {
    id: 102, week_id: 11, match_number: 1, final_score: '0-0',
    picked_map: 'Cobblestone', shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null,
    shirts_pick: 'Cobblestone', skins_starting_side: null, is_playoff_game: false, is_feature_match: false,
    pre_match_win_prob: null, pre_match_win_prob_formula_version: null, scheduled_at: null,
    round_history: null, recording_url: null,
    replay_status: 'none',
  },
  {
    id: 200, week_id: 12, match_number: 1, final_score: '13-11',
    picked_map: 'Foroglio', shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null,
    shirts_pick: 'Foroglio', skins_starting_side: 'T', is_playoff_game: true, is_feature_match: false,
    pre_match_win_prob: null, pre_match_win_prob_formula_version: null, scheduled_at: null,
    round_history: null, recording_url: null,
    replay_status: 'ready',
  },
  {
    id: 300, week_id: 14, match_number: 1, final_score: '13-5',
    picked_map: 'Vertigo', shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null,
    shirts_pick: 'Vertigo', skins_starting_side: 'CT', is_playoff_game: true, is_feature_match: false,
    pre_match_win_prob: null, pre_match_win_prob_formula_version: null, scheduled_at: null,
    round_history: null, recording_url: null,
    replay_status: 'ready',
  },
  {
    id: 400, week_id: 13, match_number: 1, final_score: null,
    picked_map: null, shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null,
    shirts_pick: null, skins_starting_side: null, is_playoff_game: false, is_feature_match: false,
    pre_match_win_prob: null, pre_match_win_prob_formula_version: null, scheduled_at: null,
    round_history: null, recording_url: null,
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

function sab(overrides: Partial<SabFields> & { player_match_stats_id: number }): Row {
  return { ...zeroSabFields(overrides), player_match_stats_id: overrides.player_match_stats_id };
}

export const PLAYER_MATCH_SABREMETRICS: Row[] = [
  sab({ player_match_stats_id: 1000, damage_ct: 1020, damage_t: 861, kast_rounds: 17, flashes_thrown: 8, plants: 3, trade_kill_opportunities: 5, trade_kill_attempts: 4, trade_kill_successes: 3 }),
  sab({ player_match_stats_id: 1001, damage_ct: 940, damage_t: 780, kast_rounds: 15, flashes_thrown: 9, defuses: 1, trade_kill_opportunities: 4, trade_kill_attempts: 3, trade_kill_successes: 2 }),
  sab({ player_match_stats_id: 1002, damage_ct: 720, damage_t: 710, kast_rounds: 12, flashes_thrown: 5, trade_kill_opportunities: 3, trade_kill_attempts: 2, trade_kill_successes: 1 }),
  sab({ player_match_stats_id: 1003, damage_ct: 670, damage_t: 652, kast_rounds: 11, flashes_thrown: 6, trade_kill_opportunities: 3, trade_kill_attempts: 2, trade_kill_successes: 1 }),

  sab({ player_match_stats_id: 1012, damage_ct: 1150, damage_t: 962, kast_rounds: 19, flashes_thrown: 7, plants: 2, trade_kill_opportunities: 6, trade_kill_attempts: 5, trade_kill_successes: 4 }),
  sab({ player_match_stats_id: 1013, damage_ct: 1000, damage_t: 920, kast_rounds: 17, flashes_thrown: 8, defuses: 1, trade_kill_opportunities: 5, trade_kill_attempts: 4, trade_kill_successes: 3 }),
  sab({ player_match_stats_id: 1014, damage_ct: 880, damage_t: 800, kast_rounds: 14, flashes_thrown: 5, trade_kill_opportunities: 4, trade_kill_attempts: 3, trade_kill_successes: 2 }),
  sab({ player_match_stats_id: 1015, damage_ct: 820, damage_t: 740, kast_rounds: 12, flashes_thrown: 6, trade_kill_opportunities: 3, trade_kill_attempts: 2, trade_kill_successes: 1 }),

  sab({ player_match_stats_id: 1016, damage_ct: 900, damage_t: 810, kast_rounds: 15, flashes_thrown: 4, plants: 2, trade_kill_opportunities: 4, trade_kill_attempts: 4, trade_kill_successes: 3 }),
  sab({ player_match_stats_id: 1017, damage_ct: 820, damage_t: 764, kast_rounds: 13, flashes_thrown: 5, defuses: 1, trade_kill_opportunities: 3, trade_kill_attempts: 3, trade_kill_successes: 2 }),
  sab({ player_match_stats_id: 1018, damage_ct: 400, damage_t: 410, kast_rounds: 6, trade_kill_opportunities: 2, trade_kill_attempts: 1, trade_kill_successes: 0 }),
  sab({ player_match_stats_id: 1019, damage_ct: 350, damage_t: 370, kast_rounds: 5, trade_kill_opportunities: 2, trade_kill_attempts: 1, trade_kill_successes: 0 }),
];

// ─── match_kills ─────────────────────────────────────────────────────────
// Not a full reconstruction of every kill in each match (that would be dozens more rows per match,
// most of them irrelevant to what these fixtures actually exercise) — just enough headshot/teamkill
// rows per attacker to reproduce the headshot_kills/teamkills values already set on
// PLAYER_MATCH_SABREMETRICS above, so query-time derivation from match_kills lands on the exact same
// numbers those rows were hand-picked to represent. round_number increments once per row within a
// match purely to keep each row's (round_number, victim_player_match_stats_id) pair unique —
// match_kills' real constraint — it doesn't track each match's actual round count.

function mkill(opts: {
  match: number; round: number; attacker: number; victim: number; isTeamkill?: boolean;
}): Row {
  return {
    match_id: opts.match, round_number: opts.round,
    attacker_player_match_stats_id: opts.attacker, victim_player_match_stats_id: opts.victim,
    assister_player_match_stats_id: null, weapon: 'ak47', headshot: !opts.isTeamkill,
    noscope: false, wallbang: false, blind_kill: false, midair: false,
    is_teamkill: opts.isTeamkill ?? false, tick: opts.round * 1000,
  };
}

/** Appends `count` headshot kills by `attacker` against alternating victims from `against`,
 *  starting at `round` — returns the next free round number for this match. */
function headshotBurst(
  rows: Row[], match: number, round: number, attacker: number, against: number[], count: number,
): number {
  for (let i = 0; i < count; i++) {
    rows.push(mkill({ match, round: round + i, attacker, victim: against[i % against.length] }));
  }
  return round + count;
}

export const MATCH_KILLS: Row[] = (() => {
  const rows: Row[] = [];

  // Match 100: Alice(1000)/Bob(1001) SHIRTS vs Carol(1002)/Dave(1003) SKINS.
  let r = headshotBurst(rows, 100, 1, 1000, [1002, 1003], 9);
  r = headshotBurst(rows, 100, r, 1001, [1002, 1003], 6);
  r = headshotBurst(rows, 100, r, 1002, [1000, 1001], 5);
  rows.push(mkill({ match: 100, round: r, attacker: 1002, victim: 1001, isTeamkill: true }));
  r += 1;
  headshotBurst(rows, 100, r, 1003, [1000, 1001], 4);

  // Match 200: Alice(1012)/Bob(1013) SHIRTS vs Erin(1014)/Frank(1015) SKINS.
  r = headshotBurst(rows, 200, 1, 1012, [1014, 1015], 10);
  r = headshotBurst(rows, 200, r, 1013, [1014, 1015], 7);
  r = headshotBurst(rows, 200, r, 1014, [1012, 1013], 6);
  headshotBurst(rows, 200, r, 1015, [1012, 1013], 5);

  // Match 300: Carol(1016)/Dave(1017) SHIRTS vs Grace(1018)/Heidi(1019) SKINS.
  r = headshotBurst(rows, 300, 1, 1016, [1018, 1019], 8);
  r = headshotBurst(rows, 300, r, 1017, [1018, 1019], 6);
  r = headshotBurst(rows, 300, r, 1018, [1016, 1017], 2);
  headshotBurst(rows, 300, r, 1019, [1016, 1017], 2);

  return rows;
})();

// ─── match_rounds ────────────────────────────────────────────────────────
// One row per round MATCH_KILLS references above, with a constant shirts_side per match — no
// halftime swap modeled. deriveSideSplitCounts()'s round-by-round side resolution is already
// exercised directly by queries-kills.test.ts's unit tests (which do vary shirts_side per round);
// these rows only need to give query-time derivation a shirts_side to resolve against for every
// round match_kills uses, and a constant side per match keeps the resulting kills_ct/_t etc.
// hand-verifiable (every kill by a given attacker lands on the same side for the whole match).
function roundRows(match: number, count: number, shirtsSide: 'CT' | 'T'): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    match_id: match, round_number: i + 1, shirts_side: shirtsSide, winner_side: shirtsSide, win_reason: null,
  }));
}

export const MATCH_ROUNDS: Row[] = [
  ...roundRows(100, 25, 'CT'),
  ...roundRows(200, 28, 'CT'),
  ...roundRows(300, 18, 'T'),
];

// ─── match_utility_throws ────────────────────────────────────────────────
// Match 100 only (player_match_stats_id 1000-1003) — enough to exercise deriveUtilityCounts()'s
// merge into getAllSabremetrics()/getMatchSabremetrics(), same reasoning
// PLAYER_MATCH_WEAPON_STATS/PLAYER_MATCH_ECONOMY_STATS below give for stopping at one match. Each
// row below is its own independent, hand-verifiable scenario (one throw per round, ticks well
// clear of round boundaries) rather than a dense reconstruction of a real game:
// - round 1: Bob(1001) flashes Carol(1002, enemy) for 1.5s at tick 900; round 1's existing kill
//   (Alice(1000) kills Carol(1002) at tick 1000, MATCH_KILLS above) lands inside both the
//   flashes_leading_to_kill window (900-1044) and the flash-assist window (900-1188), and Alice is
//   Bob's SHIRTS teammate — so this one throw drives enemies_flashed/effective_flashes/
//   blind_duration_dealt/blind_duration_max_sum/flashes_leading_to_kill/flash_assists all at once
//   for Bob.
// - round 2: Carol(1002) flashes teammate Dave(1003, both SKINS) for 2.0s — teamflash_duration
//   only.
// - round 3: Dave(1003) flashes Bob(1001, enemy) for 0.5s — below the 1.1s half-blind threshold,
//   so only the raw blind_duration_dealt exposure counts.
// - round 4: Alice(1000) flashes herself for 1.0s — a self-flash, ignored entirely.
// - round 5: Bob(1001) flashes Dave(1003, enemy) for 1.3s; round 5's kill is Alice killing Carol
//   (not Dave), so no death lands in this flash's window — a "clean" effective-flash with no
//   assist/kill credit.
export const MATCH_UTILITY_THROWS: Row[] = [
  { match_id: 100, round_number: 1, tick: 900, flasher_player_match_stats_id: 1001, blinded_player_match_stats_id: 1002, blind_duration: 1.5 },
  { match_id: 100, round_number: 2, tick: 1900, flasher_player_match_stats_id: 1002, blinded_player_match_stats_id: 1003, blind_duration: 2.0 },
  { match_id: 100, round_number: 3, tick: 2900, flasher_player_match_stats_id: 1003, blinded_player_match_stats_id: 1001, blind_duration: 0.5 },
  { match_id: 100, round_number: 4, tick: 3900, flasher_player_match_stats_id: 1000, blinded_player_match_stats_id: 1000, blind_duration: 1.0 },
  { match_id: 100, round_number: 5, tick: 4900, flasher_player_match_stats_id: 1001, blinded_player_match_stats_id: 1003, blind_duration: 1.3 },
];

// ─── player_match_weapon_stats / player_match_economy_stats ────────────────────────────────
// Match 100 only (player_match_stats_id 1000-1003) — enough to exercise the season join and the
// per-category/per-tier aggregation without duplicating every played-match id above.

export const PLAYER_MATCH_WEAPON_STATS: Row[] = [
  { player_match_stats_id: 1000, match_id: 100, weapon_category: 'rifle', shots_fired: 90, shots_hit: 40, headshot_hits: 18, damage_dealt: 3200, rounds_played: 20 },
  { player_match_stats_id: 1000, match_id: 100, weapon_category: 'pistol', shots_fired: 20, shots_hit: 8, headshot_hits: 3, damage_dealt: 400, rounds_played: 4 },
  { player_match_stats_id: 1001, match_id: 100, weapon_category: 'rifle', shots_fired: 85, shots_hit: 32, headshot_hits: 12, damage_dealt: 2600, rounds_played: 19 },
  { player_match_stats_id: 1002, match_id: 100, weapon_category: 'sniper', shots_fired: 40, shots_hit: 15, headshot_hits: 9, damage_dealt: 1800, rounds_played: 18 },
  { player_match_stats_id: 1003, match_id: 100, weapon_category: 'smg', shots_fired: 60, shots_hit: 20, headshot_hits: 5, damage_dealt: 1300, rounds_played: 16 },
];

export const PLAYER_MATCH_ECONOMY_STATS: Row[] = [
  { player_match_stats_id: 1000, match_id: 100, economy_type: 'full_buy', shots_fired: 95, shots_hit: 42, headshot_hits: 19, damage_dealt: 3400, rounds_played: 18 },
  { player_match_stats_id: 1000, match_id: 100, economy_type: 'eco', shots_fired: 15, shots_hit: 6, headshot_hits: 2, damage_dealt: 200, rounds_played: 4 },
  { player_match_stats_id: 1001, match_id: 100, economy_type: 'full_buy', shots_fired: 80, shots_hit: 30, headshot_hits: 11, damage_dealt: 2500, rounds_played: 17 },
  { player_match_stats_id: 1001, match_id: 100, economy_type: 'force_buy', shots_fired: 5, shots_hit: 2, headshot_hits: 1, damage_dealt: 100, rounds_played: 5 },
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
  { id: 1, entity_type: 'season', entity_id: 1, operation: 'gauntlet_auto_seed', message: 'Could not seed pod 3: ambiguous tiebreak', occurred_at: '2026-02-01T00:00:00.000Z', dismissed_at: null },
  { id: 2, entity_type: 'match', entity_id: 100, operation: 'steam_id_learn', message: 'Player Bob has no linked steam_id', occurred_at: '2026-01-10T00:00:00.000Z', dismissed_at: null },
  { id: 3, entity_type: 'system', entity_id: 0, operation: 'ehog_recompute', message: 'Recompute failed: timeout', occurred_at: '2026-03-01T00:00:00.000Z', dismissed_at: null },
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

// ─── player_name_history ─────────────────────────────────────────────────────
// Bob (id 2) renamed once. Every other player has no rows — the common case.

export const PLAYER_NAME_HISTORY: Row[] = [
  { id: 1, player_id: 2, old_name: 'Robert', new_name: 'Bob', changed_at: '2026-02-01T00:00:00.000Z' },
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
  skins_starting_side: null, is_playoff_game: false, is_feature_match: false,
  pre_match_win_prob: null, pre_match_win_prob_formula_version: null, scheduled_at: null,
  round_history: null, recording_url: null,
  replay_status: 'none',
}));

// ─── Season roster ─────────────────────────────────────────────────────────
// Season 6 (id 3, ACTIVE) has an explicit roster; Season 5 (id 1) has only an orphan row —
// referencing a player_id absent from PLAYERS — exercising both the empty-roster path and
// getSeasonRoster()'s `if (!player) continue` skip branch.

export const SEASON_PLAYERS: Row[] = [
  { id: 1, season_id: 3, player_id: 1, joined_at: '2026-03-15T00:00:00.000Z' },
  { id: 2, season_id: 3, player_id: 3, joined_at: '2026-03-16T00:00:00.000Z' },
  { id: 3, season_id: 3, player_id: 2, joined_at: '2026-03-14T00:00:00.000Z' },
  { id: 4, season_id: 1, player_id: 999, joined_at: '2026-01-10T00:00:00.000Z' },
];

// ─── Season schedule draft ───────────────────────────────────────────────────
// A single-week draft for Season 6 (id 3) — one bye (player 5) and one match (shirts 1+2 vs
// skins 3+4). Season 5 (id 1) deliberately has no draft rows, exercising the "no draft yet" path.

export const SEASON_SCHEDULE_DRAFT_WEEKS: Row[] = [{ id: 1, season_id: 3, week_number: 1, bye_player_id: 5 }];

export const SEASON_SCHEDULE_DRAFT_MATCHES: Row[] = [
  { id: 1, draft_week_id: 1, match_number: 1, shirts_player1_id: 1, shirts_player2_id: 2, skins_player1_id: 3, skins_player2_id: 4 },
];

// ─── Assembly ────────────────────────────────────────────────────────────

export function buildFakeDb(): FakeDb {
  return {
    seasons: SEASONS,
    weeks: WEEKS,
    matches: [...MATCHES, ...PAGINATION_FILLER_MATCHES],
    players: PLAYERS,
    player_match_stats: PLAYER_MATCH_STATS,
    player_match_sabremetrics: PLAYER_MATCH_SABREMETRICS,
    match_kills: MATCH_KILLS,
    match_rounds: MATCH_ROUNDS,
    match_utility_throws: MATCH_UTILITY_THROWS,
    player_match_weapon_stats: PLAYER_MATCH_WEAPON_STATS,
    player_match_economy_stats: PLAYER_MATCH_ECONOMY_STATS,
    player_season_leaderboard: PLAYER_SEASON_LEADERBOARD,
    maps: MAPS,
    gauntlet_pods: GAUNTLET_PODS,
    gauntlet_pod_slots: GAUNTLET_POD_SLOTS,
    background_jobs: BACKGROUND_JOBS,
    ops_errors: OPS_ERRORS,
    player_current_ratings: PLAYER_CURRENT_RATINGS,
    player_rating_history: PLAYER_RATING_HISTORY,
    player_name_history: PLAYER_NAME_HISTORY,
    season_players: SEASON_PLAYERS,
    season_schedule_draft_weeks: SEASON_SCHEDULE_DRAFT_WEEKS,
    season_schedule_draft_matches: SEASON_SCHEDULE_DRAFT_MATCHES,
  };
}
