// Session gates for scrim night signups: the "admin-or-self" shape `season-roster-access.ts` also
// has — an admin can sign up or drop any player, a player only themselves — plus, for an existing
// night, a check that it hasn't ended. Signups stay open through the night itself, so players can
// join or drop while it's running.

import { NextRequest } from 'next/server';
import { requireSession } from './session';
import { isPlayerAdmin, getScrimNightById } from './queries';
import { hasScrimNightEnded, type ScrimNight } from './scrim-schedule';
import { selfOrAdminTarget, type AccessResult } from './access-control';
import { parseRouteId } from './util';

/** The night with route param `id`, if it hasn't ended — 400 for a malformed id, 404 for no such
 *  night, 409 for one that's over. */
export async function findCurrentScrimNight(id: string, now: Date): Promise<AccessResult<{ night: ScrimNight }>> {
  const nightId = parseRouteId(id);
  if (nightId === null) return { ok: false, status: 400, error: 'Invalid scrim night id' };
  const night = await getScrimNightById(nightId);
  if (!night) return { ok: false, status: 404, error: 'Scrim night not found' };
  if (hasScrimNightEnded(night, now)) return { ok: false, status: 409, error: 'That scrim night is over' };
  return { ok: true, night };
}

export type ScrimSignupTarget = AccessResult<{ targetPlayerId: number; body: unknown }>;

/** The player a signup request acts on (`body.player_id`): the requester, or anyone for an admin. */
export async function requireScrimSignupTarget(req: NextRequest): Promise<ScrimSignupTarget> {
  const session = await requireSession();
  const requestingPlayerId = session?.user?.playerId;
  if (!requestingPlayerId) return { ok: false, status: 401, error: 'Unauthorized' };
  const [body, admin] = await Promise.all([req.json().catch(() => null), isPlayerAdmin(requestingPlayerId)]);
  const target = selfOrAdminTarget(body, requestingPlayerId, admin);
  if (!target.ok) return target;
  return { ok: true, targetPlayerId: target.targetPlayerId, body };
}

export type ScrimSignupAccess = AccessResult<{ targetPlayerId: number; night: ScrimNight; body: unknown }>;

/** `requireScrimSignupTarget()` for a night that hasn't ended (`findCurrentScrimNight()`). */
export async function requireScrimSignupAccess(req: NextRequest, id: string, now: Date = new Date()): Promise<ScrimSignupAccess> {
  const target = await requireScrimSignupTarget(req);
  if (!target.ok) return target;
  const found = await findCurrentScrimNight(id, now);
  if (!found.ok) return found;
  return { ok: true, targetPlayerId: target.targetPlayerId, night: found.night, body: target.body };
}
