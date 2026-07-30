// Shared persistence for `player_match_weapon_stats`/`player_match_economy_stats` — keyed off
// `player_match_stats.id`, mirroring `demo/sabremetrics.ts`'s pattern so the score confirm route
// and the demo-ingest reparse path share one upsert/delete implementation.

import { getAdminClient } from '../supabase-admin';
import type { DemoWeaponStat } from '../types';
import { resolvePlayerMatchStatsIds } from './_shared';

/** Upsert weapon-category and round-economy breakdown rows for a match. Rows whose `player_id`
 *  has no matching `player_match_stats` row for this match are dropped. */
export async function persistWeaponStats(
  matchId: number,
  weaponStats: DemoWeaponStat[],
): Promise<void> {
  if (weaponStats.length === 0) return;
  const supabaseAdmin = getAdminClient();
  const pmsById = await resolvePlayerMatchStatsIds(matchId);

  const weaponRows: Record<string, unknown>[] = [];
  const economyRows: Record<string, unknown>[] = [];
  for (const s of weaponStats) {
    const pmsId = pmsById.get(s.player_id);
    if (!pmsId) continue;
    for (const w of s.weaponStats) weaponRows.push({ player_match_stats_id: pmsId, ...w });
    for (const e of s.economyStats) economyRows.push({ player_match_stats_id: pmsId, ...e });
  }

  await Promise.all([
    weaponRows.length > 0
      ? supabaseAdmin.from('player_match_weapon_stats').upsert(weaponRows, { onConflict: 'player_match_stats_id,weapon_category' })
      : Promise.resolve(),
    economyRows.length > 0
      ? supabaseAdmin.from('player_match_economy_stats').upsert(economyRows, { onConflict: 'player_match_stats_id,economy_type' })
      : Promise.resolve(),
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
