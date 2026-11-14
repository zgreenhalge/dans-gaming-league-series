// Writes for a season's setup. Reads live in `src/lib/queries/`. Every write throws on failure so the
// calling route reports it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { upsertNewMaps, type NewMap } from './season-map-pool';
import type { Season } from './types';

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

/** A new regular season: `mapPool` and `buyInAmount` are `null` until decided, `newMaps` the maps entered
 *  with it that the `maps` table lacks. */
export interface NewSeason {
  name: string;
  mapPool: string[] | null;
  buyInAmount: number | null;
  newMaps: NewMap[];
}

/** Creates an UPCOMING regular season and returns its row, throwing on failure. A map added by
 *  `upsertNewMaps()` stays in the `maps` table if the season insert then fails. */
export async function createSeason(db: SupabaseClient, season: NewSeason): Promise<Season> {
  await upsertNewMaps(db, season.newMaps);
  const { data } = await db
    .from('seasons')
    .insert({
      name: season.name,
      status: 'UPCOMING',
      is_gauntlet: false,
      map_pool: season.mapPool,
      target_win_rounds: 13,
      buy_in_amount: season.buyInAmount,
    })
    .select('*')
    .single()
    .throwOnError();
  return data as Season;
}

/** Sets a season's map pool (`null` clears it), throwing on failure. The new maps are written first, so
 *  the pool is unchanged if either write fails. */
export async function setSeasonMapPool(db: SupabaseClient, seasonId: number, mapPool: string[] | null, newMaps: NewMap[]): Promise<void> {
  await upsertNewMaps(db, newMaps);
  await db.from('seasons').update({ map_pool: mapPool }).eq('id', seasonId).throwOnError();
}
