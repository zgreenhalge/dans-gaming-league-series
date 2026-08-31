// Persistence for `match_damage_events` — one row per `player_hurt` event, resolved from
// `player_id` (what the collector works in) to `player_match_stats_id` (the DB's FK), same
// resolution `matchKills.ts`/`weaponStats.ts`/`sabremetrics.ts` already do via
// `resolvePlayerMatchStatsIds()`.

import type { DemoMatchDamageEvent } from '../types';
import type { Database } from '../database.types';
import { resolvePlayerMatchStatsIds } from './_shared';
import { replaceMatchRows } from './factTables';

type DamageEventRow = Database['public']['Tables']['match_damage_events']['Insert'];

/** Replace this match's `match_damage_events` rows. A hit whose victim has no resolvable
 *  `player_match_stats` row is dropped (an attacker missing a row just nulls that column — the
 *  hit itself still needs to be recorded against the victim), matching `persistMatchKills()`. */
export async function persistMatchDamageEvents(
  matchId: number,
  events: DemoMatchDamageEvent[],
): Promise<void> {
  const pmsById = await resolvePlayerMatchStatsIds(matchId);

  const rows: DamageEventRow[] = [];
  for (const e of events) {
    const victimPmsId = pmsById.get(e.victim_player_id);
    if (!victimPmsId) continue;
    rows.push({
      match_id: matchId,
      round_number: e.round_number,
      attacker_player_match_stats_id:
        e.attacker_player_id != null ? (pmsById.get(e.attacker_player_id) ?? null) : null,
      victim_player_match_stats_id: victimPmsId,
      weapon: e.weapon,
      damage: e.damage,
      hitgroup: e.hitgroup,
      tick: e.tick,
    });
  }

  await replaceMatchRows('match_damage_events', matchId, rows);
}

/** Delete all `match_damage_events` rows for a match — e.g. a re-entered score with no derivable
 *  damage events. */
export async function clearMatchDamageEvents(matchId: number): Promise<void> {
  await replaceMatchRows('match_damage_events', matchId, []);
}
