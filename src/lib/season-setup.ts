// Writes for a season's setup. Reads live in `src/lib/queries/`. Every write throws on failure so the
// calling route reports it.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Why `deleteUpcomingSeason()` refused: no such season, one that isn't a deletable UPCOMING regular
 *  season, or one that already has a schedule. The message is the user-facing one. */
export class SeasonDeleteRefusedError extends Error {
  constructor(readonly reason: 'not-found' | 'not-upcoming' | 'has-schedule') {
    super(SEASON_DELETE_REFUSALS[reason]);
    this.name = 'SeasonDeleteRefusedError';
  }
}

const SEASON_DELETE_REFUSALS: Record<SeasonDeleteRefusedError['reason'], string> = {
  'not-found': 'Season not found',
  'not-upcoming': 'Only an upcoming season can be deleted',
  'has-schedule': 'This season already has a schedule and cannot be deleted here',
};

/** Deletes an UPCOMING regular season with its schedule draft and roster (`delete_upcoming_season()`,
 *  one transaction, so nothing is left half-deleted). Throws `SeasonDeleteRefusedError` for a season
 *  that is missing, not UPCOMING, a gauntlet, or already scheduled. */
export async function deleteUpcomingSeason(db: SupabaseClient, seasonId: number): Promise<void> {
  const { error } = await db.rpc('delete_upcoming_season', { p_season_id: seasonId });
  if (!error) return;
  for (const reason of Object.keys(SEASON_DELETE_REFUSALS) as SeasonDeleteRefusedError['reason'][]) {
    if (error.message.includes(`season-${reason}`)) throw new SeasonDeleteRefusedError(reason);
  }
  throw new Error(error.message);
}
