// Shared plumbing for every demo-derived-stat persistence module (sabremetrics.ts, weaponStats.ts)
// — each stores rows keyed off `player_match_stats.id`, not `player_id`/`match_id` directly, so
// every persist/clear needs this same resolution first.

import { getAdminClient } from '../supabase-admin';

/** `player_id -> player_match_stats.id` for a match. */
export async function resolvePlayerMatchStatsIds(matchId: number): Promise<Map<number, number>> {
  const supabaseAdmin = getAdminClient();
  const { data: pmsRows, error } = await supabaseAdmin
    .from('player_match_stats')
    .select('id, player_id')
    .eq('match_id', matchId);
  if (error) {
    throw new Error(`resolvePlayerMatchStatsIds(${matchId}) select failed: ${error.message}`);
  }
  return new Map(
    ((pmsRows ?? []) as { id: number; player_id: number }[]).map((r) => [r.player_id, r.id]),
  );
}
