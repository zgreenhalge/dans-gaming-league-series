// Session gate for a scrim night's signups: the "admin-or-self" shape `season-roster-access.ts` also
// has — an admin can sign up or drop any player, a player only themselves — plus a check that the
// night is one players can still sign up for: listed by `scrimNightSlots()` (scheduled, not yet
// ended) and not cancelled. Signups stay open through the night itself, so players can join or drop
// while it's running.

import { NextRequest } from 'next/server';
import { requireSession } from './session';
import { isPlayerAdmin, getScrimNights } from './queries';
import { isNightDate, type ScrimNightSlot } from './scrim-schedule';
import { selfOrAdminTarget, type AccessResult } from './access-control';

export type ScrimSignupAccess = AccessResult<{ targetPlayerId: number; slot: ScrimNightSlot; body: unknown }>;

export async function requireScrimSignupAccess(req: NextRequest, date: string, now: Date = new Date()): Promise<ScrimSignupAccess> {
  if (!isNightDate(date)) return { ok: false, status: 400, error: 'Invalid scrim night date' };

  const session = await requireSession();
  const requestingPlayerId = session?.user?.playerId;
  if (!requestingPlayerId) return { ok: false, status: 401, error: 'Unauthorized' };

  const [{ slots }, body, admin] = await Promise.all([
    getScrimNights(now),
    req.json().catch(() => null),
    isPlayerAdmin(requestingPlayerId),
  ]);

  const target = selfOrAdminTarget(body, requestingPlayerId, admin);
  if (!target.ok) return target;

  const slot = slots.find((s) => s.date === date);
  if (!slot) return { ok: false, status: 404, error: 'No upcoming scrim night on that date' };
  if (slot.cancelled) return { ok: false, status: 409, error: 'That scrim night is cancelled' };

  return { ok: true, targetPlayerId: target.targetPlayerId, slot, body };
}
