import type { Row } from './fakeSupabase';

/** A `scrim_nights` row starting `offsetMs` from the real clock — for route tests, since the scrim
 *  routes read the clock themselves. */
export function scrimNightStartingIn(offsetMs: number, id = 5): Row {
  return { id, starts_at: new Date(Date.now() + offsetMs).toISOString(), ended_at: null };
}
