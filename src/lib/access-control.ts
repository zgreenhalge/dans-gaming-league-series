import { NextResponse } from 'next/server';
import { parseRouteId } from './util';

// Shared result shape for session-based access gates (`admin-access.ts`, `match-access.ts`,
// `season-roster-access.ts`, `scrim-signup-access.ts`). A caller's `if (!access.ok) return accessDenied(access)` narrows
// correctly against any gate built on this.
//
// `machine-auth.ts` is deliberately not built on this — it guards a different concern (a shared-secret
// header, not a player session) and already returns a ready-to-send `NextResponse | null` instead of
// a result its caller has to translate into one.

export type AccessResult<T extends object = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string };

/** The response for a failed gate result: its `error` as the JSON body, with its `status`. */
export function accessDenied(access: Extract<AccessResult, { ok: false }>) {
  return NextResponse.json({ error: access.error }, { status: access.status });
}

/**
 * The player an "admin-or-self" request acts for: the body's `player_id`, which must be the requester
 * themselves unless they're an admin. 400 without a valid `player_id`, 403 for a non-admin naming
 * someone else.
 */
export function selfOrAdminTarget(
  body: unknown,
  requestingPlayerId: number,
  admin: boolean,
): AccessResult<{ targetPlayerId: number }> {
  const rawPlayerId = (body as { player_id?: unknown } | null)?.player_id;
  const targetPlayerId =
    typeof rawPlayerId === 'number' || typeof rawPlayerId === 'string' ? parseRouteId(String(rawPlayerId)) : null;
  if (targetPlayerId === null) return { ok: false, status: 400, error: 'player_id is required' };
  if (!admin && targetPlayerId !== requestingPlayerId) return { ok: false, status: 403, error: 'Forbidden' };
  return { ok: true, targetPlayerId };
}
