// Writes for a league match's day-of edits: its pick/ban, scheduled time, feature flag and recording
// link. The rules they follow are in `veto.ts`; the routes (`PATCH /api/matches/[id]/veto`, `.../schedule`,
// `.../feature`, `POST .../recording`) gate and validate. Every write throws on failure so the calling
// route reports it, and every write throws `MatchNotFoundError` when no match has the id.

import type { SupabaseClient } from '@supabase/supabase-js';
import { GAUNTLET_BAN_FIELDS, VETO_FIELDS, gauntletAutoPick, type VetoFields } from './veto';

/** Thrown by every writer here when no match has the id. A route answers it with a 404. */
export class MatchNotFoundError extends Error {
  constructor() {
    super('Match not found');
    this.name = 'MatchNotFoundError';
  }
}

/** Thrown by `setVetoFields()` when a pick/ban field no longer holds the value the caller read. Its
 *  message is the user-facing one. */
export class VetoStepChangedError extends Error {
  constructor() {
    super('That pick/ban was just changed by someone else — reload to see it.');
    this.name = 'VetoStepChangedError';
  }
}

const VETO_COLUMNS = VETO_FIELDS.join(', ');

/** Reads a match's pick/ban fields. Throws `MatchNotFoundError` when no match has that id. */
export async function getVetoFields(db: SupabaseClient, matchId: number): Promise<VetoFields> {
  const { data } = await db.from('matches').select(VETO_COLUMNS).eq('id', matchId).maybeSingle().throwOnError();
  if (!data) throw new MatchNotFoundError();
  return data as unknown as VetoFields;
}

/** Writes pick/ban fields on a match (a `null` clears one) and returns the pick/ban fields as the write
 *  left them. `expected` names the fields the caller read and the values it read them at (`null` for an
 *  empty one): the write only lands while every one still holds that value, so of two players filling
 *  the same step at once only the first does, and an overwrite never replaces a value the caller did not
 *  see. A write that finds a field changed throws `VetoStepChangedError`. Leave `expected` out to write
 *  unconditionally. Throws `MatchNotFoundError` when no match has that id. */
export async function setVetoFields(
  db: SupabaseClient,
  matchId: number,
  update: Partial<VetoFields>,
  expected: Partial<VetoFields> = {},
): Promise<VetoFields> {
  let write = db.from('matches').update(update).eq('id', matchId);
  for (const [field, value] of Object.entries(expected)) {
    if (value === undefined) continue;
    write = value === null ? write.is(field, null) : write.eq(field, value);
  }
  const { data } = await write.select(VETO_COLUMNS).throwOnError();
  if (data.length > 0) return data[0] as unknown as VetoFields;
  // Nothing matched: either the match is gone or an expected field changed. `getVetoFields()` tells them apart.
  await getVetoFields(db, matchId);
  throw new VetoStepChangedError();
}

/** Sets a gauntlet match's `shirts_pick` to the map its four bans leave, when they leave one, and returns
 *  the pick/ban fields as they then stand. `row` is the pick/ban row the bans are read from (the one
 *  `setVetoFields()` returned). The pick is written against those bans: if one changed meanwhile, that
 *  change's own request derives the pick, and this returns the row as it now stands. */
export async function setGauntletPick(db: SupabaseClient, matchId: number, row: VetoFields, mapPool: string[]): Promise<VetoFields> {
  const pick = gauntletAutoPick(row, mapPool);
  if (pick === null || pick === row.shirts_pick) return row;
  const bans = Object.fromEntries(GAUNTLET_BAN_FIELDS.map((f) => [f, row[f]]));
  try {
    return await setVetoFields(db, matchId, { shirts_pick: pick }, bans);
  } catch (err) {
    if (err instanceof VetoStepChangedError) return getVetoFields(db, matchId);
    throw err;
  }
}

/** Applies `values` to a match, throwing `MatchNotFoundError` when no match has that id. */
async function updateMatch(db: SupabaseClient, matchId: number, values: Record<string, unknown>): Promise<void> {
  const { data } = await db.from('matches').update(values).eq('id', matchId).select('id').throwOnError();
  if (data.length === 0) throw new MatchNotFoundError();
}

/** Sets a match's scheduled time, or clears it with `null`. */
export function setMatchScheduledAt(db: SupabaseClient, matchId: number, scheduledAt: string | null): Promise<void> {
  return updateMatch(db, matchId, { scheduled_at: scheduledAt });
}

/** Sets whether a match is a feature match. */
export function setMatchFeatured(db: SupabaseClient, matchId: number, featured: boolean): Promise<void> {
  return updateMatch(db, matchId, { is_feature_match: featured });
}

/** Sets a match's recording link, or clears it with `null`. */
export function setMatchRecording(db: SupabaseClient, matchId: number, recordingUrl: string | null): Promise<void> {
  return updateMatch(db, matchId, { recording_url: recordingUrl });
}
