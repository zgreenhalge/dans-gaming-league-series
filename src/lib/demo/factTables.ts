// Shared persistence for any table keyed by a `match_id` column and populated fresh on every parse
// (`match_kills`, `match_rounds`, `match_utility_throws`, `match_round_economy`,
// `player_match_weapon_stats`, `player_match_economy_stats`, ...) — delete-then-insert, not upsert,
// since a reparse can produce a different row *count* than the previous parse (e.g. fewer kills, a
// different round count), and upsert has no "this row wasn't in the new parse" signal to act on.
// One shared implementation so no fact table reimplements the same delete/insert pair by hand.

import { getAdminClient } from '../supabase-admin';
import type { Database } from '../database.types';

// The real invariant this function needs is "has a match_id column" — checked structurally against
// each table's Row shape rather than inferred from a naming convention, so any table gains this
// helper for free the moment it has that column, regardless of what it's called.
type FactTableName = {
  [K in keyof Database['public']['Tables']]: Database['public']['Tables'][K]['Row'] extends { match_id: number }
    ? K
    : never;
}[keyof Database['public']['Tables']];

/** Replace every row for `matchId` in `table` with `rows`. A no-op insert (but still deletes stale
 *  rows) when `rows` is empty, so clearing a match's fact rows is just calling this with `[]`.
 *
 *  The `.from(table)` calls below go through an untyped view of the client: PostgREST's generated
 *  client can't resolve its per-table overloads from a generic `Table` type parameter, only a
 *  string literal. Callers stay fully typed (`table`/`rows` are checked against `Table`'s real
 *  `Insert` shape by the signature above) — only this function's internals lose that checking.
 *
 *  Supabase's `.delete()`/`.insert()` return `{ error }` rather than throwing, so both are checked
 *  and thrown here — otherwise a failed insert (e.g. a unique-constraint violation) leaves the
 *  table silently empty for that match while the caller's job still reports success. */
export async function replaceMatchRows<Table extends FactTableName>(
  table: Table,
  matchId: number,
  rows: Database['public']['Tables'][Table]['Insert'][],
): Promise<void> {
  const supabaseAdmin = getAdminClient() as unknown as {
    from(table: string): {
      delete(): { eq(column: string, value: number): Promise<{ error: { message: string } | null }> };
      insert(rows: unknown[]): Promise<{ error: { message: string } | null }>;
    };
  };
  const { error: deleteError } = await supabaseAdmin.from(table).delete().eq('match_id', matchId);
  if (deleteError) {
    throw new Error(`replaceMatchRows(${table}, ${matchId}) delete failed: ${deleteError.message}`);
  }
  if (rows.length > 0) {
    const { error: insertError } = await supabaseAdmin.from(table).insert(rows);
    if (insertError) {
      throw new Error(`replaceMatchRows(${table}, ${matchId}) insert failed: ${insertError.message}`);
    }
  }
}
