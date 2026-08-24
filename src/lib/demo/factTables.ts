// Shared persistence for per-match-event fact tables (`match_kills`, `match_rounds`, and any future
// one-row-per-event table) — delete-then-insert, not upsert, since a reparse can produce a different
// row *count* than the previous parse (e.g. fewer kills, a different round count), and upsert has no
// "this row wasn't in the new parse" signal to act on. Mirrors `weaponStats.ts`'s persistence pattern,
// generalized so each fact table doesn't reimplement the same delete/insert pair.

import { getAdminClient } from '../supabase-admin';
import type { Database } from '../database.types';

type FactTableName = keyof Database['public']['Tables'] & (`match_${string}`);

/** Replace every row for `matchId` in `table` with `rows`. A no-op insert (but still deletes stale
 *  rows) when `rows` is empty, so clearing a match's fact rows is just calling this with `[]`.
 *
 *  The `.from(table)` calls below go through an untyped view of the client: PostgREST's generated
 *  client can't resolve its per-table overloads from a generic `Table` type parameter, only a
 *  string literal. Callers stay fully typed (`table`/`rows` are checked against `Table`'s real
 *  `Insert` shape by the signature above) — only this function's internals lose that checking. */
export async function replaceMatchRows<Table extends FactTableName>(
  table: Table,
  matchId: number,
  rows: Database['public']['Tables'][Table]['Insert'][],
): Promise<void> {
  const supabaseAdmin = getAdminClient() as unknown as {
    from(table: string): {
      delete(): { eq(column: string, value: number): Promise<unknown> };
      insert(rows: unknown[]): Promise<unknown>;
    };
  };
  await supabaseAdmin.from(table).delete().eq('match_id', matchId);
  if (rows.length > 0) {
    await supabaseAdmin.from(table).insert(rows);
  }
}
