import type { SabFields } from '../types';
import type { MatchContext } from './matchContext';
import { initCollector, roundOf } from './_shared';

type CollectorOut = Map<string, Partial<SabFields>>;

export interface PlayerBlindRow {
  tick: number;
  total_rounds_played: number;
  attacker_steamid: string | null;
  user_steamid: string | null;
  blind_duration: number;
}

export interface WeaponFireRow {
  tick: number;
  total_rounds_played: number;
  user_steamid: string | null;
  weapon: string;
}

export interface UtilityThrowFactRow {
  round_number: number;
  flasher_steamid: string;
  blinded_steamid: string;
  blind_duration: number;
  tick: number;
}

/**
 * One row per `player_blind` event — a `match_utility_throws` fact table row, not a per-player
 * aggregate (unlike `collectUtility()` below). Kept flat so downstream queries decide at read time
 * which flashes "count" (e.g. led to a kill/assist within some window) rather than baking that
 * judgment into the collector — same convention `collectMatchKills()` (`weaponStats.ts`) follows
 * for teamkills. Self-flashes (flasher === blinded) are kept too, for the same reason.
 */
export function collectMatchUtilityThrows(
  blindEvents: PlayerBlindRow[],
  context: MatchContext,
  steamIds: string[],
): UtilityThrowFactRow[] {
  const steamSet = new Set(steamIds);
  const rows: UtilityThrowFactRow[] = [];

  for (const b of blindEvents) {
    const round = roundOf(b, context);
    if (round == null) continue;

    const flasher = b.attacker_steamid;
    const blinded = b.user_steamid;
    if (!flasher || !steamSet.has(flasher)) continue;
    if (!blinded || !steamSet.has(blinded)) continue;

    rows.push({
      round_number: round,
      flasher_steamid: flasher,
      blinded_steamid: blinded,
      blind_duration: b.blind_duration ?? 0,
      tick: b.tick,
    });
  }

  return rows;
}

/**
 * Flashes thrown per player — the one utility stat that stays live-collected rather than derived
 * from `match_utility_throws` at query time, since it needs `weapon_fire` events (no fact table
 * carries them). Every other flash stat (`flash_assists`, `teamflash_duration`, `enemies_flashed`,
 * `flashes_leading_to_kill`, `effective_flashes`, `blind_duration_dealt`, `blind_duration_max_sum`)
 * is `queries/utility.ts`'s `deriveUtilityCounts()`, reading `match_utility_throws` instead
 * (#489).
 */
export function collectUtility(
  fireEvents: WeaponFireRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const { out, steamSet } = initCollector<SabFields>(steamIds);

  for (const f of fireEvents) {
    if (f.weapon !== 'weapon_flashbang') continue;
    if (roundOf(f, context) == null) continue;
    const thrower = f.user_steamid;
    if (!thrower || !steamSet.has(thrower)) continue;
    const p = out.get(thrower)!;
    p.flashes_thrown = ((p.flashes_thrown as number) ?? 0) + 1;
  }

  return out;
}
