// Shared persistence for `player_match_weapon_stats`/`player_match_economy_stats` — keyed off
// `player_match_stats.id`, mirroring `demo/sabremetrics.ts`'s pattern so the score confirm route
// and the demo-ingest reparse path share one upsert/delete implementation.

import { getAdminClient } from '../supabase-admin';
import type { DemoWeaponStat } from '../types';
import type { Database } from '../database.types';
import { resolvePlayerMatchStatsIds } from './_shared';

type WeaponRow = Database['public']['Tables']['player_match_weapon_stats']['Insert'];
type EconomyRow = Database['public']['Tables']['player_match_economy_stats']['Insert'];

/** Replace weapon-category and round-economy breakdown rows for a match. Rows whose `player_id`
 *  has no matching `player_match_stats` row for this match are dropped.
 *
 *  Delete-then-insert, not upsert: unlike `player_match_sabremetrics` (one row per player, so an
 *  upsert always fully overwrites it), each player has several bucket rows here, and a reparse can
 *  produce a smaller bucket set than the previous parse (e.g. no sniper shots this time) — an
 *  upsert has no "this bucket wasn't in the new parse" signal to act on, so it would leave that
 *  now-stale row behind forever. Deleting every existing row for the match's `player_match_stats`
 *  ids first guarantees the persisted set always matches this parse exactly. */
export async function persistWeaponStats(
  matchId: number,
  weaponStats: DemoWeaponStat[],
): Promise<void> {
  if (weaponStats.length === 0) return;
  const supabaseAdmin = getAdminClient();
  const pmsById = await resolvePlayerMatchStatsIds(matchId);

  const weaponRows: WeaponRow[] = [];
  const economyRows: EconomyRow[] = [];
  const pmsIds: number[] = [];
  for (const s of weaponStats) {
    const pmsId = pmsById.get(s.player_id);
    if (!pmsId) continue;
    pmsIds.push(pmsId);
    for (const w of s.weaponStats) weaponRows.push({ player_match_stats_id: pmsId, ...w });
    for (const e of s.economyStats) economyRows.push({ player_match_stats_id: pmsId, ...e });
  }
  if (pmsIds.length === 0) return;

  await Promise.all([
    supabaseAdmin.from('player_match_weapon_stats').delete().in('player_match_stats_id', pmsIds),
    supabaseAdmin.from('player_match_economy_stats').delete().in('player_match_stats_id', pmsIds),
  ]);
  await Promise.all([
    weaponRows.length > 0 ? supabaseAdmin.from('player_match_weapon_stats').insert(weaponRows) : Promise.resolve(),
    economyRows.length > 0 ? supabaseAdmin.from('player_match_economy_stats').insert(economyRows) : Promise.resolve(),
  ]);
}

/** Delete all weapon-category/round-economy rows for a match — e.g. a re-entered score with no
 *  derivable weapon stats. */
export async function clearWeaponStats(matchId: number): Promise<void> {
  const supabaseAdmin = getAdminClient();
  const pmsIds = [...(await resolvePlayerMatchStatsIds(matchId)).values()];
  if (pmsIds.length > 0) {
    await Promise.all([
      supabaseAdmin.from('player_match_weapon_stats').delete().in('player_match_stats_id', pmsIds),
      supabaseAdmin.from('player_match_economy_stats').delete().in('player_match_stats_id', pmsIds),
    ]);
  }
}
