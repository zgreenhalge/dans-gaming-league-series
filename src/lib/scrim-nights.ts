// Writes for scrim nights: starting one, its signups, check-in, dropping out (which removes a night
// nobody is left in), ending one and reopening it. Reads live in `src/lib/queries/scrims.ts`; the timing
// logic in `scrim-schedule.ts`. Every write throws on failure so the calling route reports it.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScrimCommitment } from './scrim-schedule';

/** Thrown by `startScrimNight()` when the new night's slot overlaps another night's (`scrimNightEnd()`). */
export class OverlappingScrimNightError extends Error {
  constructor() {
    super('Another scrim night overlaps that time — sign up for it instead.');
    this.name = 'OverlappingScrimNightError';
  }
}

/** Starts a night at `startsAt` with `playerId` as its first signup (`start_scrim_night()`, one
 *  transaction). Returns the new night id. */
export async function startScrimNight(db: SupabaseClient, startsAt: string, playerId: number, commitment: ScrimCommitment): Promise<number> {
  const { data, error } = await db.rpc('start_scrim_night', {
    p_starts_at: startsAt,
    p_player_id: playerId,
    p_commitment: commitment,
  });
  if (error) {
    if (error.message.includes('overlapping-scrim-night')) throw new OverlappingScrimNightError();
    throw new Error(error.message);
  }
  return data as number;
}

/** Signs `playerId` up for a night, or changes their commitment if they're already signed up (keeping
 *  their original `signed_up_at`). */
export async function setScrimSignup(db: SupabaseClient, nightId: number, playerId: number, commitment: ScrimCommitment): Promise<void> {
  await db
    .from('scrim_signups')
    .upsert({ night_id: nightId, player_id: playerId, commitment }, { onConflict: 'night_id,player_id' })
    .throwOnError();
}

/** Drops `playerId` from a night (a no-op if they weren't signed up), removing the night once nobody
 *  is left and it has no matches (`leave_scrim_night()`). Returns whether the night was removed. */
export async function leaveScrimNight(db: SupabaseClient, nightId: number, playerId: number): Promise<boolean> {
  const { data, error } = await db.rpc('leave_scrim_night', { p_night_id: nightId, p_player_id: playerId });
  if (error) throw new Error(error.message);
  return data as boolean;
}

/** Checks `playerId` in to a night, or out again. Checking in makes the signup `definite`, creating
 *  one for a player who turns up without having signed up; checking out keeps the signup. */
export async function setScrimCheckIn(db: SupabaseClient, nightId: number, playerId: number, checkedIn: boolean): Promise<void> {
  if (checkedIn) {
    await db
      .from('scrim_signups')
      .upsert(
        { night_id: nightId, player_id: playerId, commitment: 'definite', checked_in_at: new Date().toISOString() },
        { onConflict: 'night_id,player_id' },
      )
      .throwOnError();
  } else {
    await db.from('scrim_signups').update({ checked_in_at: null }).eq('night_id', nightId).eq('player_id', playerId).throwOnError();
  }
}

/** Ends a running night now, so its signups, check-in and lobby close. A night that has already been
 *  ended keeps its original end. */
export async function endScrimNight(db: SupabaseClient, nightId: number): Promise<void> {
  await db
    .from('scrim_nights')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', nightId)
    .is('ended_at', null)
    .throwOnError();
}

/** Thrown by `reopenScrimNight()` when another night holds the shared server now. */
export class CurrentScrimNightError extends Error {
  constructor() {
    super('Another scrim night is on the server now — it has to end before this one can reopen.');
    this.name = 'CurrentScrimNightError';
  }
}

/** Reopens a night that is over (`reopen_scrim_night()`): clears `ended_at` and counts now as activity,
 *  so it is current again until it is ended or goes idle. */
export async function reopenScrimNight(db: SupabaseClient, nightId: number): Promise<void> {
  const { error } = await db.rpc('reopen_scrim_night', { p_night_id: nightId });
  if (error) {
    if (error.message.includes('current-scrim-night')) throw new CurrentScrimNightError();
    throw new Error(error.message);
  }
}
