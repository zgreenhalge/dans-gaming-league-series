// Shared persistence for `player_match_sabremetrics` — keyed off `player_match_stats.id`, not
// `player_id`/`match_id` directly. Used by the score confirm route and the demo-ingest reparse path
// so the upsert/delete logic and the player_id -> player_match_stats.id resolution live in one place.

import { getAdminClient } from '../supabase-admin';
import type { DemoSabremetricStat } from '../types';
import { resolvePlayerMatchStatsIds } from './_shared';

/** Upsert sabremetrics rows for a match. Rows whose `player_id` has no matching
 *  `player_match_stats` row for this match are dropped.
 *
 *  `pmsById` lets a caller that's already resolving it for sibling fact tables (a score confirm
 *  writes ~6 of these concurrently for the same match) pass its own map instead of this function
 *  re-querying `player_match_stats` redundantly — omit it to resolve independently. */
export async function persistSabremetrics(
  matchId: number,
  sabremetrics: DemoSabremetricStat[],
  pmsById?: Map<number, number>,
): Promise<void> {
  if (sabremetrics.length === 0) return;
  const supabaseAdmin = getAdminClient();
  pmsById ??= await resolvePlayerMatchStatsIds(matchId);

  const sabRows = sabremetrics
    .map((s) => {
      const pmsId = pmsById.get(s.player_id);
      if (!pmsId) return null;
      return { player_match_stats_id: pmsId, ...s.sabremetrics };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (sabRows.length > 0) {
    await supabaseAdmin
      .from('player_match_sabremetrics')
      .upsert(sabRows, { onConflict: 'player_match_stats_id' });
  }
}

/** Delete all sabremetrics rows for a match — e.g. a re-entered score with no derivable
 *  sabremetrics. See `persistSabremetrics()` for `pmsById`. */
export async function clearSabremetrics(matchId: number, pmsById?: Map<number, number>): Promise<void> {
  const supabaseAdmin = getAdminClient();
  const pmsIds = [...(pmsById ?? await resolvePlayerMatchStatsIds(matchId)).values()];
  if (pmsIds.length > 0) {
    await supabaseAdmin
      .from('player_match_sabremetrics')
      .delete()
      .in('player_match_stats_id', pmsIds);
  }
}
