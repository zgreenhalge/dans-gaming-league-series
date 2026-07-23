/**
 * Write side of `player_name_history` (read side: `getPlayerNameHistory()` in
 * `src/lib/queries/player.ts`) — mirrors the `ops-errors.ts` split of a best-effort write helper
 * living alongside, not inside, the read-only query layer. Shared by both routes that can change a
 * player's name (`PATCH /api/players/[id]`, admin; `PATCH /api/players/me/name`, self-service) so
 * the two can't drift on how a rename gets logged.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Records a completed rename — best-effort, since the rename itself already committed and must
 * not be rolled back over a logging failure; this only risks a gap in the audit trail. */
export async function recordNameChange(
  supabaseAdmin: SupabaseClient,
  playerId: number,
  oldName: string,
  newName: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('player_name_history')
    .insert({ player_id: playerId, old_name: oldName, new_name: newName });
  if (error) console.error(`player_name_history insert failed for player ${playerId}:`, error);
}
