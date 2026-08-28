import { supabase } from '../supabase';
import { fetchAllPages, fetchPmsLookup, bumpCounter, type PmsRow } from './_shared';
import type { Faction } from '../types';
import type { KillCreditFlags } from './kills';

export interface UtilityThrowRow {
  match_id: number;
  round_number: number;
  tick: number;
  flasher_player_id: number;
  blinded_player_id: number;
  blind_duration: number;
}

type RawThrowRow = {
  match_id: number;
  round_number: number;
  tick: number;
  flasher_player_match_stats_id: number;
  blinded_player_match_stats_id: number;
  blind_duration: number;
};

/** Every recorded flash (`match_utility_throws`), resolved to `player_id`s only — no season filter,
 *  no name join, matching `getAllKillCreditFlags()`'s reasoning for skipping those joins. Pass
 *  `pmsRows` when the caller already fetched `player_match_stats` to skip a redundant full-table
 *  fetch; pass `matchId` to scope to one match. */
export async function getAllUtilityThrows(
  matchId?: number,
  pmsRows?: PmsRow[] | Promise<PmsRow[]>,
): Promise<UtilityThrowRow[]> {
  const [rows, pmsLookup] = await Promise.all([
    fetchAllPages<RawThrowRow>((from, to) => {
      let q = supabase.from('match_utility_throws').select('*');
      if (matchId != null) q = q.eq('match_id', matchId);
      return q.range(from, to);
    }),
    fetchPmsLookup(matchId, pmsRows),
  ]);

  const out: UtilityThrowRow[] = [];
  for (const r of rows) {
    const flasherPms = pmsLookup.get(r.flasher_player_match_stats_id);
    const blindedPms = pmsLookup.get(r.blinded_player_match_stats_id);
    if (!flasherPms || !blindedPms) continue;
    out.push({
      match_id: r.match_id,
      round_number: r.round_number,
      tick: r.tick,
      flasher_player_id: flasherPms.player_id,
      blinded_player_id: blindedPms.player_id,
      blind_duration: r.blind_duration,
    });
  }
  return out;
}

export interface UtilityCounts {
  flash_assists: number;
  teamflash_duration: number;
  enemies_flashed: number;
  flashes_leading_to_kill: number;
  effective_flashes: number;
  blind_duration_dealt: number;
  blind_duration_max_sum: number;
}

export const ZERO_UTILITY: UtilityCounts = {
  flash_assists: 0, teamflash_duration: 0, enemies_flashed: 0, flashes_leading_to_kill: 0,
  effective_flashes: 0, blind_duration_dealt: 0, blind_duration_max_sum: 0,
};

// Leetify excludes "half-blind" exposure (< 1.1s) from flash-effectiveness stats (enemies_flashed,
// flash assists, flashes_leading_to_kill, effective_flashes/blind_duration_max_sum).
// blind_duration_dealt/teamflash_duration stay ungated — they're raw exposure measures, not
// effectiveness measures. Matches parsers/utility.ts's collectUtility(), which this replaces.
const HALF_BLIND_THRESHOLD = 1.1;
const FLASH_ASSIST_WINDOW_SECONDS = 3;
// CS2 demos frequently omit a usable tickrate in their header; 64 is the correct constant for this
// league (parsers/matchContext.ts falls back to the same value for the identical reason, and every
// DGLS match is recorded at it) — there's no per-match tick rate persisted anywhere queryable, so
// this is a fixed assumption rather than a per-match lookup.
const TICK_RATE = 64;

function bump(out: Map<string, UtilityCounts>, key: string, field: keyof UtilityCounts, amount = 1): void {
  bumpCounter(out, key, ZERO_UTILITY, field, amount);
}

interface FlashGroup {
  matchId: number;
  flasherId: number;
  durations: number[];
}

/**
 * Per (match, player) utility-effectiveness counts — the query-time replacement for
 * `flash_assists`, `teamflash_duration`, `enemies_flashed`, `flashes_leading_to_kill`,
 * `effective_flashes`, `blind_duration_dealt`, and `blind_duration_max_sum` on
 * `player_match_sabremetrics`, ported from `parsers/utility.ts`'s `collectUtility()` (its
 * flash-thrown counting stays live-collected — `flashes_thrown` needs `weapon_fire` events, which
 * no fact table carries).
 *
 * A self-flash (flasher === blinded) is excluded from every stat, matching the parser. Whether a
 * flash hit a teammate or an enemy is resolved from each player's fixed match `faction` —
 * `match_utility_throws` needs no side/round lookup the way kill-credit CT/T splits do, since
 * "same team" is a faction question, not a side question.
 *
 * `deaths` is the same `KillCreditFlags[]` the kill-credit `derive*()` functions take — only
 * `victim_player_id`/`tick`/`round_number`/`attacker_player_id` are read here, to build a per-victim
 * death lookup for `flashes_leading_to_kill`/`flash_assists`'s tick-window checks.
 */
export function deriveUtilityCounts(
  throws: UtilityThrowRow[],
  deaths: KillCreditFlags[],
  playerFactions: Map<string, Faction>,
): Map<string, UtilityCounts> {
  const out = new Map<string, UtilityCounts>();

  const deathLookup = new Map<string, { tick: number; round_number: number; attacker_player_id: number | null }[]>();
  for (const d of deaths) {
    const key = `${d.match_id}:${d.victim_player_id}`;
    const entry = { tick: d.tick, round_number: d.round_number, attacker_player_id: d.attacker_player_id };
    const list = deathLookup.get(key);
    if (list) list.push(entry);
    else deathLookup.set(key, [entry]);
  }

  const flashGroups = new Map<string, FlashGroup>();

  for (const t of throws) {
    if (t.flasher_player_id === t.blinded_player_id) continue;
    const flasherFaction = playerFactions.get(`${t.match_id}:${t.flasher_player_id}`);
    const blindedFaction = playerFactions.get(`${t.match_id}:${t.blinded_player_id}`);
    if (flasherFaction == null || blindedFaction == null) continue;

    const key = `${t.match_id}:${t.flasher_player_id}`;
    const isTeammate = flasherFaction === blindedFaction;

    if (isTeammate) {
      bump(out, key, 'teamflash_duration', t.blind_duration);
      continue;
    }

    bump(out, key, 'blind_duration_dealt', t.blind_duration);
    if (t.blind_duration < HALF_BLIND_THRESHOLD) continue;

    bump(out, key, 'enemies_flashed');

    const groupKey = `${t.match_id}:${t.flasher_player_id}:${t.round_number}:${t.tick}`;
    let group = flashGroups.get(groupKey);
    if (!group) {
      group = { matchId: t.match_id, flasherId: t.flasher_player_id, durations: [] };
      flashGroups.set(groupKey, group);
    }
    group.durations.push(t.blind_duration);

    const blindExpireTick = t.tick + Math.round(t.blind_duration * TICK_RATE);
    // Leetify's own wording ("if the flashed player then gets killed") doesn't specify an exact
    // cutoff, so this stat extends half the flash's own duration past its expiry rather than
    // stopping the instant the blind ends — a kill immediately after an enemy's vision clears is
    // still meaningfully attributable to the flash.
    const ledToKillWindowEnd = blindExpireTick + Math.round((t.blind_duration / 2) * TICK_RATE);
    const victimDeaths = deathLookup.get(`${t.match_id}:${t.blinded_player_id}`) ?? [];

    // flashes_leading_to_kill: the victim died within [blind_start_tick, ledToKillWindowEnd] by
    // anyone, including the flasher's own kill. Distinct from flash_assists below, which only
    // credits a teammate's kill inside a fixed window after the blind expires.
    const ledToKill = victimDeaths.some(
      (d) => d.round_number === t.round_number && d.tick >= t.tick && d.tick <= ledToKillWindowEnd,
    );
    if (ledToKill) bump(out, key, 'flashes_leading_to_kill');

    // Flash assist: the enemy is killed by a teammate of the flasher (not the flasher themselves)
    // within FLASH_ASSIST_WINDOW_SECONDS after the blind expires.
    const windowEnd = blindExpireTick + Math.round(FLASH_ASSIST_WINDOW_SECONDS * TICK_RATE);
    const assisted = victimDeaths.some((d) => {
      if (d.round_number !== t.round_number) return false;
      if (d.tick > windowEnd || d.tick < t.tick) return false;
      if (d.attacker_player_id == null || d.attacker_player_id === t.flasher_player_id) return false;
      const attackerFaction = playerFactions.get(`${t.match_id}:${d.attacker_player_id}`);
      return attackerFaction != null && attackerFaction === flasherFaction;
    });
    if (assisted) bump(out, key, 'flash_assists');
  }

  // One effective flash per (flasher, round, tick) group; its contribution to
  // blind_duration_max_sum is the longest qualifying blind it caused, not the sum across every
  // enemy it hit.
  for (const group of flashGroups.values()) {
    const key = `${group.matchId}:${group.flasherId}`;
    bump(out, key, 'effective_flashes');
    bump(out, key, 'blind_duration_max_sum', Math.max(...group.durations));
  }

  return out;
}

export function lookupUtilityCounts(key: string, counts: Map<string, UtilityCounts>): UtilityCounts {
  return counts.get(key) ?? ZERO_UTILITY;
}
