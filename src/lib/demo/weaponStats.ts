// Shared persistence for `player_match_weapon_stats`/`player_match_economy_stats` — bucketed rows
// keyed off `player_match_stats.id`, using the same `match_id`-scoped replace-on-reparse mechanics
// as every other demo-derived fact table.

import type { DemoWeaponStat } from '../types';
import type { Database } from '../database.types';
import { resolvePlayerMatchStatsIds } from './_shared';
import { replaceMatchRows } from './factTables';

type WeaponRow = Database['public']['Tables']['player_match_weapon_stats']['Insert'];
type EconomyRow = Database['public']['Tables']['player_match_economy_stats']['Insert'];

/** Replace weapon-category and round-economy breakdown rows for a match. Rows whose `player_id`
 *  has no matching `player_match_stats` row for this match are dropped.
 *
 *  Delete-then-insert via `replaceMatchRows()`, not upsert: unlike `player_match_sabremetrics`
 *  (one row per player, so an upsert always fully overwrites it), each player has several bucket
 *  rows here, and a reparse can produce a smaller bucket set than the previous parse (e.g. no
 *  sniper shots this time) — an upsert has no "this bucket wasn't in the new parse" signal to act
 *  on, so it would leave that now-stale row behind forever. Replacing every row for the match first
 *  guarantees the persisted set always matches this parse exactly. */
export async function persistWeaponStats(
  matchId: number,
  weaponStats: DemoWeaponStat[],
): Promise<void> {
  if (weaponStats.length === 0) return;
  const pmsById = await resolvePlayerMatchStatsIds(matchId);

  const weaponRows: WeaponRow[] = [];
  const economyRows: EconomyRow[] = [];
  for (const s of weaponStats) {
    const pmsId = pmsById.get(s.player_id);
    if (!pmsId) continue;
    for (const w of s.weaponStats) weaponRows.push({ match_id: matchId, player_match_stats_id: pmsId, ...w });
    for (const e of s.economyStats) economyRows.push({ match_id: matchId, player_match_stats_id: pmsId, ...e });
  }

  await Promise.all([
    replaceMatchRows('player_match_weapon_stats', matchId, weaponRows),
    replaceMatchRows('player_match_economy_stats', matchId, economyRows),
  ]);
}

/** Delete all weapon-category/round-economy rows for a match — e.g. a re-entered score with no
 *  derivable weapon stats. */
export async function clearWeaponStats(matchId: number): Promise<void> {
  await Promise.all([
    replaceMatchRows('player_match_weapon_stats', matchId, []),
    replaceMatchRows('player_match_economy_stats', matchId, []),
  ]);
}
