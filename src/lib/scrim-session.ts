// A scrim is a single, ephemeral, roster-free session on the shared DatHost server — see
// `src/app/api/scrim/*`. `scrim_sessions` is a singleton table (a fixed `id = 1` row, enforced by a
// primary-key check constraint): at most one row can ever exist, so claiming it is one atomic INSERT
// rather than a check-then-act read, and ending it is a DELETE. Row present = a scrim is live; absent
// = the server's free for one to start (or held by a real DGLS match instead, checked separately).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DathostServer } from './dathost';
import { isServerLive } from './util';

export interface ScrimSession {
  startedBy: number;
  /** Display name of `startedBy`, joined from `players` — `null` only if the player row is missing. */
  startedByName: string | null;
  warned15: boolean;
  warned10: boolean;
  warned5: boolean;
}

const UNIQUE_VIOLATION = '23505';

/** Selects every `ScrimSession` field in one round trip, embedding the starter's name via the FK. */
const SCRIM_SESSION_COLUMNS = 'started_by, warned_15, warned_10, warned_5, players(name)';

interface ScrimSessionRow {
  started_by: number;
  warned_15: boolean;
  warned_10: boolean;
  warned_5: boolean;
  players: { name: string } | null;
}

function toScrimSession(row: ScrimSessionRow): ScrimSession {
  return {
    startedBy: row.started_by,
    startedByName: row.players?.name ?? null,
    warned15: row.warned_15,
    warned10: row.warned_10,
    warned5: row.warned_5,
  };
}

/**
 * Claims the singleton scrim session for `playerId`, or `null` if one's already active. The INSERT's
 * primary-key collision (not a prior SELECT) is what makes this race-safe under concurrent starts.
 */
export async function claimScrimSession(
  supabaseAdmin: SupabaseClient,
  playerId: number,
): Promise<ScrimSession | null> {
  const { data, error } = await supabaseAdmin
    .from('scrim_sessions')
    .insert({ id: 1, started_by: playerId })
    .select(SCRIM_SESSION_COLUMNS)
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null;
    throw error;
  }
  return toScrimSession(data as unknown as ScrimSessionRow);
}

/** The active scrim session, or `null` if none is running. */
export async function getScrimSession(supabaseAdmin: SupabaseClient): Promise<ScrimSession | null> {
  const { data } = await supabaseAdmin.from('scrim_sessions').select(SCRIM_SESSION_COLUMNS).eq('id', 1).maybeSingle();
  return data ? toScrimSession(data as unknown as ScrimSessionRow) : null;
}

/** Ends the active scrim session, if any. Idempotent — deleting an already-absent row is a no-op. */
export async function releaseScrimSession(supabaseAdmin: SupabaseClient): Promise<void> {
  await supabaseAdmin.from('scrim_sessions').delete().eq('id', 1);
}

const WARNED_COLUMN = { 15: 'warned_15', 10: 'warned_10', 5: 'warned_5' } as const;

/** Marks one of the three pre-match warning thresholds as sent, so `scrim-warnings.ts` fires it once. */
export async function markScrimWarned(supabaseAdmin: SupabaseClient, threshold: 15 | 10 | 5): Promise<void> {
  await supabaseAdmin
    .from('scrim_sessions')
    .update({ [WARNED_COLUMN[threshold]]: true })
    .eq('id', 1);
}

/** Whether `threshold`'s warning has already been sent for `session` — the single source of truth for
 *  the 15/10/5 → `warned*` field mapping, so callers never hand-roll the ternary themselves. */
export function isScrimWarned(session: ScrimSession, threshold: 15 | 10 | 5): boolean {
  return threshold === 15 ? session.warned15 : threshold === 10 ? session.warned10 : session.warned5;
}

/**
 * A session row can outlive the scrim it describes if the server was stopped some other way (the
 * admin console, a DatHost idle timeout, the panel directly) — anything other than `/api/scrim/stop`.
 * Called wherever scrim status is read: if a session row exists but the server isn't actually on,
 * the row is stale and gets cleared right there, so the singleton can never get permanently stuck.
 */
export async function reconcileScrimSession(
  supabaseAdmin: SupabaseClient,
  server: DathostServer | null,
): Promise<ScrimSession | null> {
  const session = await getScrimSession(supabaseAdmin);
  if (!session) return null;
  if (isServerLive(server)) return session;
  await releaseScrimSession(supabaseAdmin);
  return null;
}
