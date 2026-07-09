/**
 * Generic surface for best-effort operations that fail (or produce an outcome needing admin
 * attention, like a roster drift) without ever rolling back the primary action they ride along
 * with — a gauntlet auto-seed, a demo's sabremetrics write, an EHOG recompute. These are recorded
 * here rather than only `console.error`'d, since application logs aren't visible to an admin
 * deciding what to do next. Read (with resolved display labels) via `getOpsErrors()` in
 * `queries.ts`; dismiss via `DELETE /api/ops-errors/[id]`.
 *
 * Keyed by `(entity_type, entity_id, operation)` rather than just `entity_id`, since more than one
 * operation can attach to the same entity (a match's steam-id learning and its server teardown, for
 * instance) — without `operation` in the key, one operation's success would clear an unrelated
 * operation's still-live failure. `entity_id` is `0` for operations with no single entity (the
 * site-wide EHOG recompute).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type OpsErrorEntityType = 'season' | 'match' | 'player' | 'system';

/** Records (or overwrites) the current failure for a given (entity, operation) pair — best-effort
 * itself, since a failure here shouldn't turn a secondary logging problem into a thrown error. */
export async function recordOpsError(
  supabaseAdmin: SupabaseClient,
  entityType: OpsErrorEntityType,
  entityId: number,
  operation: string,
  message: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from('ops_errors').upsert(
    { entity_type: entityType, entity_id: entityId, operation, message, occurred_at: new Date().toISOString() },
    { onConflict: 'entity_type,entity_id,operation' },
  );
  if (error) console.error(`ops-error record failed(${entityType} ${entityId}/${operation}):`, error);
}

/** Clears a stale error left by an earlier failed attempt at this (entity, operation) pair —
 * best-effort, since a failure here shouldn't turn a real success into an error response. */
export async function clearOpsError(
  supabaseAdmin: SupabaseClient,
  entityType: OpsErrorEntityType,
  entityId: number,
  operation: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('ops_errors')
    .delete()
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('operation', operation);
  if (error) console.error(`ops-error clear failed(${entityType} ${entityId}/${operation}):`, error);
}
