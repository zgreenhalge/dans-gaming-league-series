// Session gate for a scrim night's signups: the "admin-or-self" shape `season-roster-access.ts` also
// has — an admin can sign up or drop any player, a player only themselves — plus a check that the
// night is still listed by `scrimNightSlots()` (scheduled, not yet ended). Signups stay open through
// the night itself, so players can join or drop while it's running. The signup route refuses new
// signups for a cancelled night; dropping out of one is always allowed.

import { NextRequest } from 'next/server';
import { requireSession } from './session';
import { isPlayerAdmin, getScrimNights } from './queries';
import { isNightDate, type ScrimNightSlot } from './scrim-schedule';
import { selfOrAdminTarget, type AccessResult } from './access-control';

/** The listed (not yet ended) scrim night on `date`, cancelled or not — 400 for a malformed date,
 *  404 for one with no upcoming night. Shared by the signup gate and the admin cancel route. */
export async function findUpcomingScrimNight(date: string, now: Date): Promise<AccessResult<{ slot: ScrimNightSlot }>> {
  if (!isNightDate(date)) return { ok: false, status: 400, error: 'Invalid scrim night date' };
  const { slots } = await getScrimNights(now);
  const slot = slots.find((s) => s.date === date);
  if (!slot) return { ok: false, status: 404, error: 'No upcoming scrim night on that date' };
  return { ok: true, slot };
}

export type ScrimSignupAccess = AccessResult<{ targetPlayerId: number; slot: ScrimNightSlot; body: unknown }>;

export async function requireScrimSignupAccess(req: NextRequest, date: string, now: Date = new Date()): Promise<ScrimSignupAccess> {
  if (!isNightDate(date)) return { ok: false, status: 400, error: 'Invalid scrim night date' };

  const session = await requireSession();
  const requestingPlayerId = session?.user?.playerId;
  if (!requestingPlayerId) return { ok: false, status: 401, error: 'Unauthorized' };

  const [night, body, admin] = await Promise.all([
    findUpcomingScrimNight(date, now),
    req.json().catch(() => null),
    isPlayerAdmin(requestingPlayerId),
  ]);

  const target = selfOrAdminTarget(body, requestingPlayerId, admin);
  if (!target.ok) return target;
  if (!night.ok) return night;

  return { ok: true, targetPlayerId: target.targetPlayerId, slot: night.slot, body };
}
