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

/** Records that this rename's audit-log write couldn't even be attempted (e.g. its "from" name
 * couldn't be read) — same key as `recordNameChange`'s own failure, so a later successful log
 * write clears either. */
export async function recordNameHistoryLogError(
  supabaseAdmin: SupabaseClient,
  playerId: number,
  message: string,
): Promise<void> {
  await recordOpsError(supabaseAdmin, 'player', playerId, NAME_HISTORY_LOG_OPERATION, message);
}

/** Records a completed rename — best-effort, since the rename itself already committed and must
 * not be rolled back over a logging failure. A failure here is recorded to `ops_errors` (not just
 * `console.error`'d) purely so it's visible to an admin — `player_name_history` is an audit trail
 * only; the self-service cooldown itself is gated on `players.name_changed_at`, not this table. */
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
    await recordNameHistoryLogError(supabaseAdmin, playerId, error.message);
  } else {
    await clearOpsError(supabaseAdmin, 'player', playerId, NAME_HISTORY_LOG_OPERATION);
  }
}

/** The `players` fields a rename must set together — bundling `name` with the self-service
 * cooldown's gate timestamp so a write path can't change one without the other. Both rename routes
 * (`PATCH /api/players/[id]`, admin; `PATCH /api/players/me/name`, self-service) build their update
 * through this rather than setting `name_changed_at` inline. */
export function renameFields(newName: string): { name: string; name_changed_at: string } {
  return { name: newName, name_changed_at: new Date().toISOString() };
}
