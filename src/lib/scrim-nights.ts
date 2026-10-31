// Writes for scrim nights: the weekly schedule, a night's cancellation, and its signups. Reads live in
// `src/lib/queries/scrims.ts`; the date/slot logic in `scrim-schedule.ts`. Every write throws on
// failure so the calling route reports it.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScrimCommitment, ScrimSchedule } from './scrim-schedule';

/** Replaces the weekly schedule (the singleton `scrim_schedule` row). */
export async function saveScrimSchedule(db: SupabaseClient, schedule: ScrimSchedule): Promise<void> {
  await db
    .from('scrim_schedule')
    .upsert({ id: 1, weekday: schedule.weekday, start_time: schedule.startTime, timezone: schedule.timezone, enabled: schedule.enabled })
    .throwOnError();
}

/** The `scrim_nights` row id for `date`, creating the row if it doesn't exist yet. The upsert leaves
 *  an existing row (and its `cancelled` flag) untouched, so concurrent first signups share one row. */
export async function ensureScrimNight(db: SupabaseClient, date: string): Promise<number> {
  await db.from('scrim_nights').upsert({ night_date: date }, { onConflict: 'night_date', ignoreDuplicates: true }).throwOnError();
  const { data } = await db.from('scrim_nights').select('id').eq('night_date', date).single().throwOnError();
  return (data as { id: number }).id;
}

/** Cancels or restores the night on `date`. Its signups are kept either way. */
export async function setScrimNightCancelled(db: SupabaseClient, date: string, cancelled: boolean): Promise<void> {
  await db.from('scrim_nights').upsert({ night_date: date, cancelled }, { onConflict: 'night_date' }).throwOnError();
}

/** Signs `playerId` up for a night, or changes their commitment if they're already signed up (keeping
 *  their original `signed_up_at`). */
export async function setScrimSignup(db: SupabaseClient, nightId: number, playerId: number, commitment: ScrimCommitment): Promise<void> {
  await db
    .from('scrim_signups')
    .upsert({ night_id: nightId, player_id: playerId, commitment }, { onConflict: 'night_id,player_id' })
    .throwOnError();
}

/** Drops `playerId` from a night. A no-op if they weren't signed up. */
export async function removeScrimSignup(db: SupabaseClient, nightId: number, playerId: number): Promise<void> {
  await db.from('scrim_signups').delete().eq('night_id', nightId).eq('player_id', playerId).throwOnError();
}
