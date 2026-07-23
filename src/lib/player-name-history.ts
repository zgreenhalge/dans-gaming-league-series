/**
 * Write side of `player_name_history` (read side: `getPlayerNameHistory()` in
 * `src/lib/queries/player.ts`) — mirrors the `ops-errors.ts` split of a best-effort write helper
 * living alongside, not inside, the read-only query layer. Shared by both routes that can change a
 * player's name (`PATCH /api/players/[id]`, admin; `PATCH /api/players/me/name`, self-service) so
 * the two can't drift on how a rename gets logged.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordOpsError, clearOpsError } from './ops-errors';

/** ops_errors `operation` key for this table's writes — exported so a caller that fails to even
 * determine a rename's "from" name (and so can't call `recordNameChange` at all) can still record
 * under the same key, letting a later successful log write clear it. */
export const NAME_HISTORY_LOG_OPERATION = 'name_history_log';

/** Records a completed rename — best-effort, since the rename itself already committed and must
 * not be rolled back over a logging failure. A failure here is recorded to `ops_errors` (not just
 * `console.error`'d): the self-service route's cooldown reads this same history, so a silently
 * missing row would let a player rename again earlier than intended with no visible trace. */
export async function recordNameChange(
  supabaseAdmin: SupabaseClient,
  playerId: number,
  oldName: string,
  newName: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('player_name_history')
    .insert({ player_id: playerId, old_name: oldName, new_name: newName });
  if (error) {
    await recordOpsError(supabaseAdmin, 'player', playerId, NAME_HISTORY_LOG_OPERATION, error.message);
  } else {
    await clearOpsError(supabaseAdmin, 'player', playerId, NAME_HISTORY_LOG_OPERATION);
  }
}
