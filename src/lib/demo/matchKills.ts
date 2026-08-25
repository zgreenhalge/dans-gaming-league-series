// Persistence for `match_kills` — one row per kill event, resolved from `player_id` (what the
// collector works in) to `player_match_stats_id` (the DB's FK), same resolution
// `weaponStats.ts`/`sabremetrics.ts` already do via `resolvePlayerMatchStatsIds()`.

import type { DemoMatchKill } from '../types';
import type { Database } from '../database.types';
import { resolvePlayerMatchStatsIds } from './_shared';
import { replaceMatchRows } from './factTables';

type KillRow = Database['public']['Tables']['match_kills']['Insert'];

/** Replace this match's `match_kills` rows. A kill whose victim has no resolvable
 *  `player_match_stats` row is dropped (attacker/assister missing a row just nulls that column —
 *  the death itself still needs to be recorded against the victim). */
export async function persistMatchKills(matchId: number, kills: DemoMatchKill[]): Promise<void> {
  const pmsById = await resolvePlayerMatchStatsIds(matchId);

  const rows: KillRow[] = [];
  for (const k of kills) {
    const victimPmsId = pmsById.get(k.victim_player_id);
    if (!victimPmsId) continue;
    rows.push({
      match_id: matchId,
      round_number: k.round_number,
      attacker_player_match_stats_id:
        k.attacker_player_id != null ? (pmsById.get(k.attacker_player_id) ?? null) : null,
      victim_player_match_stats_id: victimPmsId,
      assister_player_match_stats_id:
        k.assister_player_id != null ? (pmsById.get(k.assister_player_id) ?? null) : null,
      weapon: k.weapon,
      headshot: k.headshot,
      noscope: k.noscope,
      wallbang: k.wallbang,
      blind_kill: k.blind_kill,
      is_teamkill: k.is_teamkill,
      tick: k.tick,
    });
  }

  await replaceMatchRows('match_kills', matchId, rows);
}

/** Delete all `match_kills` rows for a match — e.g. a re-entered score with no derivable kills. */
export async function clearMatchKills(matchId: number): Promise<void> {
  await replaceMatchRows('match_kills', matchId, []);
}
