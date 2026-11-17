// The claim step both Discord notifiers take before a one-shot post (`notifyMatchReminder()` in
// `discord-notify.ts`, the scrim night message in `discord-scrim-notify.ts`): atomically set
// `reminder_sent_at` on the subject's state row so two racing calls never both post. What happens
// after the claim — posting, storing the message id, whether a failure gives the claim back — is each
// notifier's own.

import type { SupabaseClient } from '@supabase/supabase-js';

const CLAIM_TABLES = {
  match: { table: 'match_discord_state', keyColumn: 'match_id' },
  night: { table: 'scrim_night_discord_state', keyColumn: 'night_id' },
} as const;

/** The subject of a claim: a league match or a scrim night, by id. */
export interface ClaimTarget {
  kind: keyof typeof CLAIM_TABLES;
  id: number;
}

/** Claims `reminder_sent_at` on the subject's state row: seeds the row if it doesn't exist (never
 *  overwriting one that does), then `UPDATE … WHERE reminder_sent_at IS NULL`. Returns the claimed row
 *  with the `returning` columns (just the key when none are asked for), or `null` when the reminder was
 *  already sent or a concurrent call won the race. Throws when a database write fails. */
export async function claimReminderSent(
  db: SupabaseClient,
  { kind, id }: ClaimTarget,
  now: Date,
  returning: string[] = [],
): Promise<Record<string, string | null> | null> {
  const { table, keyColumn } = CLAIM_TABLES[kind];
  await db.from(table).upsert({ [keyColumn]: id, reminder_sent_at: null }, { onConflict: keyColumn, ignoreDuplicates: true }).throwOnError();
  const { data } = await db
    .from(table)
    .update({ reminder_sent_at: now.toISOString() })
    .eq(keyColumn, id)
    .is('reminder_sent_at', null)
    .select([keyColumn, ...returning].join(', '))
    .throwOnError();
  return ((data ?? [])[0] as unknown as Record<string, string | null> | undefined) ?? null;
}

/** Gives a claim back, so a later attempt can post. */
export async function releaseReminderClaim(db: SupabaseClient, { kind, id }: ClaimTarget): Promise<void> {
  const { table, keyColumn } = CLAIM_TABLES[kind];
  await db.from(table).update({ reminder_sent_at: null }).eq(keyColumn, id).throwOnError();
}
