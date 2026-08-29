import type { SabFieldsWithDerived } from '../types';
import type { SabremetricStatRow, EconomyMatchRow } from '../queries';

/** A zeroed `SabFieldsWithDerived`, overridable per test — the shared "override-style" fixture
 *  builder for every test suite that needs a sabremetrics row (`queries-sabremetrics.test.ts`,
 *  `demo/sabremetrics.test.ts`, `test-support/fixtures.ts`'s own `sab()`), so the full field list
 *  lives in exactly one place. `headshot_kills`/`teamkills` default to 0 here even though they're
 *  no longer stored on `player_match_sabremetrics` — callers that need real values (query-layer
 *  tests) override them directly; `fixtures.ts`'s `sab()` leaves them at 0 since the real source is
 *  now `MATCH_KILLS`. */
export function zeroSabFields(overrides: Partial<SabFieldsWithDerived> = {}): SabFieldsWithDerived {
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
    rounds_dropped_on_reload_total: 0, reloads_total: 0,
    ...overrides,
  };
}

/** A default `SabremetricStatRow` for one player/match, overridable — shared by
 *  `queries-sabremetrics.test.ts` and `SabremetricsLeaderboardView.test.tsx` so both build the same
 *  shape instead of two independent copies that can drift. */
export function sabremetricStatRow(
  overrides: Partial<SabremetricStatRow> & { player_id: number; match_id: number },
): SabremetricStatRow {
  return {
    player_name: `#${overrides.player_id}`,
    rounds_played: 24,
    sab: zeroSabFields(),
    ...overrides,
  };
}

/** A zeroed `EconomyMatchRow` for one player/match/tier, overridable — shared by
 *  `queries-weaponStats.test.ts` and `SabremetricsLeaderboardView.test.tsx` so both build the same
 *  shape instead of two independent copies that can drift. */
export function economyMatchRow(
  overrides: Partial<EconomyMatchRow> & { player_id: number; match_id: number; economy_type: string },
): EconomyMatchRow {
  return {
    player_name: `#${overrides.player_id}`,
    season_id: 1,
    shots_fired: 0, shots_hit: 0, headshot_hits: 0, damage_dealt: 0, rounds_played: 0,
    ...overrides,
  };
}
