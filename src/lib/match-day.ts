// Writes for a league match's day-of edits: its pick/ban, scheduled time, feature flag and recording
// link. The rules they follow are in `veto.ts`; the routes (`PATCH /api/matches/[id]/veto`, `.../schedule`,
// `.../feature`, `POST .../recording`) gate and validate. Every write throws on failure so the calling
// route reports it.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { VetoFields } from './veto';

/** Thrown by `setVetoFields()` when the pick/ban step it was filling got a value first. Its message is
 *  the user-facing one. */
export class VetoStepTakenError extends Error {
  constructor() {
    super('That pick/ban was just filled by someone else — reload to see it.');
    this.name = 'VetoStepTakenError';
  }
}

/** Writes pick/ban fields on a match (a `null` clears one). `onlyIfEmpty` names the step being filled
 *  for the first time: the write only lands while that field is still empty, so of two players
 *  submitting the same step at once only the first does, and the second gets `VetoStepTakenError`.
 *  Leave it out to overwrite a value or clear one. Throws a plain `Error` when no match has that id. */
export async function setVetoFields(
  db: SupabaseClient,
  matchId: number,
  update: Partial<VetoFields>,
  onlyIfEmpty?: keyof VetoFields,
): Promise<void> {
  const write = db.from('matches').update(update).eq('id', matchId);
  const { data } = await (onlyIfEmpty ? write.is(onlyIfEmpty, null) : write).select('id').throwOnError();
  if (data.length === 0) throw onlyIfEmpty ? new VetoStepTakenError() : new Error('Match not found');
}

/** Sets a match's scheduled time, or clears it with `null`. */
export async function setMatchScheduledAt(db: SupabaseClient, matchId: number, scheduledAt: string | null): Promise<void> {
  await db.from('matches').update({ scheduled_at: scheduledAt }).eq('id', matchId).throwOnError();
}

/** Sets whether a match is a feature match. Returns whether a match has that id. */
export async function setMatchFeatured(db: SupabaseClient, matchId: number, featured: boolean): Promise<boolean> {
  const { data } = await db.from('matches').update({ is_feature_match: featured }).eq('id', matchId).select('id').throwOnError();
  return data.length > 0;
}

/** Sets a match's recording link, or clears it with `null`. Returns whether a match has that id. */
export async function setMatchRecording(db: SupabaseClient, matchId: number, recordingUrl: string | null): Promise<boolean> {
  const { data } = await db.from('matches').update({ recording_url: recordingUrl }).eq('id', matchId).select('id').throwOnError();
  return data.length > 0;
}
