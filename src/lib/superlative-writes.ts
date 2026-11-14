// Writes for a season's superlatives vote: adding, removing, renaming and reordering its
// superlatives. Opening, closing and resetting the vote are in `feedback-lifecycle.ts`; the rules
// (titles, order, lock) in `superlatives.ts`; reads in `src/lib/queries/feedback.ts`. Every write
// throws on failure so the calling route reports it.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SuperlativePoll } from './queries';

/** Thrown by `addSuperlative()` when another request took the same position first (the
 *  `superlatives` unique constraint on season and position). The admin retries. */
export class SuperlativeRacedError extends Error {
  constructor() {
    super('Another superlative was added at the same time — try again');
    this.name = 'SuperlativeRacedError';
  }
}

/** Adds a superlative titled `title` after the season's others, creating the season's vote (closed)
 *  first when `poll` is `null`. `poll` is the vote as the caller read it, which fixes the new
 *  position. Returns the new superlative's id. */
export async function addSuperlative(db: SupabaseClient, seasonId: number, title: string, poll: SuperlativePoll | null): Promise<number> {
  if (!poll) {
    await db.from('superlative_polls').upsert({ season_id: seasonId }, { onConflict: 'season_id', ignoreDuplicates: true }).throwOnError();
  }
  const position = Math.max(0, ...(poll?.superlatives.map((s) => s.position) ?? [])) + 1;
  try {
    const { data } = await db.from('superlatives').insert({ season_id: seasonId, position, title }).select('id').single().throwOnError();
    return data.id;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new SuperlativeRacedError();
    throw err;
  }
}

/** Removes a superlative (its votes cascade). */
export async function removeSuperlative(db: SupabaseClient, seasonId: number, superlativeId: number): Promise<void> {
  await db.from('superlatives').delete().eq('id', superlativeId).eq('season_id', seasonId).throwOnError();
}

/** Renames a superlative. */
export async function renameSuperlative(db: SupabaseClient, seasonId: number, superlativeId: number, title: string): Promise<void> {
  await db.from('superlatives').update({ title }).eq('id', superlativeId).eq('season_id', seasonId).throwOnError();
}

/** Sets the season's superlatives to `order`, each id's position being its place in the list
 *  (`reorder_superlatives()`, one transaction). */
export async function reorderSuperlatives(db: SupabaseClient, seasonId: number, order: number[]): Promise<void> {
  await db.rpc('reorder_superlatives', { p_season_id: seasonId, p_order: order }).throwOnError();
}
