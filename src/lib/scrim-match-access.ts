// Session gates for scrim night matches. Creating the night's next match is open to any checked-in
// player or an admin, once check-in is open. Changing, discarding or starting a match is open to
// the players in it or an admin — the same "admin-or-in-match" shape `requireMatchAccess()` checks
// for every match.

import { requireSession } from './session';
import { requireMatchAccess } from './match-access';
import { isPlayerAdmin, getScrimSignups, getScrimMatch, type ScrimMatch } from './queries';
import { isScrimCheckInOpen, type ScrimNight } from './scrim-schedule';
import { findCurrentScrimNight } from './scrim-signup-access';
import type { AccessResult } from './access-control';

/** Players checked in to a night — the pool matchmaking and lineup changes draw from. */
export async function checkedInPlayerIds(nightId: number): Promise<number[]> {
  return (await getScrimSignups(nightId)).filter((s) => s.checked_in_at).map((s) => s.player_id);
}

export type ScrimNightMatchAccess = AccessResult<{ night: ScrimNight; checkedIn: number[] }>;

/** Gate for creating a night's next match: check-in open, and the requester checked in or an admin. */
export async function requireScrimNightMatchAccess(id: string, now: Date = new Date()): Promise<ScrimNightMatchAccess> {
  const session = await requireSession();
  const playerId = session?.user?.playerId;
  if (!playerId) return { ok: false, status: 401, error: 'Unauthorized' };

  const [found, admin] = await Promise.all([findCurrentScrimNight(id, now), isPlayerAdmin(playerId)]);
  if (!found.ok) return found;
  const { night } = found;
  if (!isScrimCheckInOpen(night, now)) {
    return { ok: false, status: 409, error: 'Matches can only be made once check-in is open' };
  }
  const checkedIn = await checkedInPlayerIds(night.id);
  if (!admin && !checkedIn.includes(playerId)) {
    return { ok: false, status: 403, error: 'Check in to make matches' };
  }
  return { ok: true, night, checkedIn };
}

export type ScrimMatchAccess = AccessResult<{ playerId: number; isAdmin: boolean; match: ScrimMatch }>;

/** Gate for changing or discarding a scrim match: an admin or a player in it, and it must be a scrim
 *  match (404 otherwise). */
export async function requireScrimMatchAccess(matchId: number): Promise<ScrimMatchAccess> {
  const [access, match] = await Promise.all([requireMatchAccess(matchId), getScrimMatch(matchId)]);
  if (!access.ok) return access;
  if (!match) return { ok: false, status: 404, error: 'Scrim match not found' };
  return { ok: true, playerId: access.playerId, isAdmin: access.isAdmin, match };
}
