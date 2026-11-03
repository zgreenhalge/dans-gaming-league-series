// Writes for scrim nights: starting one, its signups, check-in, and dropping out (which removes a
// night nobody is left in). Reads live in `src/lib/queries/scrims.ts`; the timing logic in
// `scrim-schedule.ts`. Every write throws on failure so the calling route reports it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { SCRIM_NIGHT_LENGTH_MS, type ScrimCommitment } from './scrim-schedule';

const NIGHT_HOURS = SCRIM_NIGHT_LENGTH_MS / 3_600_000;

/** Thrown by `startScrimNight()` when another night starts within `SCRIM_NIGHT_LENGTH_MS`. */
export class OverlappingScrimNightError extends Error {
  constructor() {
    super(`Another scrim night starts within ${NIGHT_HOURS} hours of that time — sign up for it instead.`);
    this.name = 'OverlappingScrimNightError';
  }
}

/** Starts a night at `startsAt` with `playerId` as its first signup (`start_scrim_night()`, one
 *  transaction). Returns the new night id. */
export async function startScrimNight(db: SupabaseClient, startsAt: string, playerId: number, commitment: ScrimCommitment): Promise<number> {
  const { data, error } = await db.rpc('start_scrim_night', {
    p_starts_at: startsAt,
    p_night_minutes: SCRIM_NIGHT_LENGTH_MS / 60_000,
    p_player_id: playerId,
    p_commitment: commitment,
  });
  if (error) {
    if (error.message.includes('overlapping-scrim-night')) throw new OverlappingScrimNightError();
    throw error;
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
  if (error) throw error;
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
