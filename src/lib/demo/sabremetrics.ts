// Shared persistence for `player_match_sabremetrics` — keyed off `player_match_stats.id`, not
// `player_id`/`match_id` directly. Used by the score confirm route and the demo-ingest reparse path
// so the upsert/delete logic and the player_id -> player_match_stats.id resolution live in one place.

import { getAdminClient } from '../supabase-admin';
import type { DemoSabremetricStat } from '../types';

/** Upsert sabremetrics rows for a match. Rows whose `player_id` has no matching
 *  `player_match_stats` row for this match are dropped. */
export async function persistSabremetrics(
  matchId: number,
  sabremetrics: DemoSabremetricStat[],
): Promise<void> {
  if (sabremetrics.length === 0) return;
  const supabaseAdmin = getAdminClient();
  const { data: pmsRows } = await supabaseAdmin
    .from('player_match_stats')
    .select('id, player_id')
    .eq('match_id', matchId);
  const pmsById = new Map(
    ((pmsRows ?? []) as { id: number; player_id: number }[]).map((r) => [r.player_id, r.id]),
  );

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

/** Delete all sabremetrics rows for a match — e.g. a re-entered score with no derivable sabremetrics. */
export async function clearSabremetrics(matchId: number): Promise<void> {
  const supabaseAdmin = getAdminClient();
  const { data: ids } = await supabaseAdmin
    .from('player_match_stats')
    .select('id')
    .eq('match_id', matchId);
  if (ids && ids.length > 0) {
    await supabaseAdmin
      .from('player_match_sabremetrics')
      .delete()
      .in('player_match_stats_id', (ids as { id: number }[]).map((r) => r.id));
  }
}
