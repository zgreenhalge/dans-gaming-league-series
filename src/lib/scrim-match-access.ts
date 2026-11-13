// Session gates for scrim night matches. Creating the night's next match is open to any checked-in
// player or an admin, once check-in is open; ending the night is open to anyone signed up for it or an
// admin, once it has started and no match is waiting for the server, and so is reopening it once it's
// over. Changing, discarding or starting a match is open to the players in it or an admin — the same
// "admin-or-in-match" shape `requireMatchAccess()` checks for every match.

import { requireSession } from './session';
import { requireMatchAccess } from './match-access';
import { isPlayerAdmin, getScrimSignups, getScrimMatch, getScrimNightMatches, type ScrimMatch } from './queries';
import { canReopenScrimNight, hasScrimNightEnded, hasScrimNightStarted, isScrimCheckInOpen, type ScrimNight } from './scrim-schedule';
import { scrimMatchNeedsServer } from './scrim-matches';
import { findCurrentScrimNight, findScrimNight } from './scrim-signup-access';
import type { AccessResult } from './access-control';

/** Players checked in to a night — the pool matchmaking and lineup changes draw from. */
export async function checkedInPlayerIds(nightId: number): Promise<number[]> {
  return (await getScrimSignups(nightId)).filter((s) => s.checked_in_at).map((s) => s.player_id);
}

/** The signed-in requester and the night `find` returns — 401 signed out, else `find`'s refusals. */
async function findNightForPlayer(
  find: () => Promise<AccessResult<{ night: ScrimNight }>>,
): Promise<AccessResult<{ night: ScrimNight; playerId: number; admin: boolean }>> {
  const session = await requireSession();
  const playerId = session?.user?.playerId;
  if (!playerId) return { ok: false, status: 401, error: 'Unauthorized' };

  const [found, admin] = await Promise.all([find(), isPlayerAdmin(playerId)]);
  if (!found.ok) return found;
  return { ok: true, night: found.night, playerId, admin };
}

/** `findNightForPlayer()` for the night with route param `id`, if it hasn't ended
 *  (`findCurrentScrimNight()`). */
function findCurrentNightForPlayer(id: string, now: Date) {
  return findNightForPlayer(() => findCurrentScrimNight(id, now));
}

/** Whether `playerId` is signed up for night `nightId` — what End night and Reopen ask of a non-admin. */
async function isSignedUp(nightId: number, playerId: number): Promise<boolean> {
  return (await getScrimSignups(nightId)).some((s) => s.player_id === playerId);
}

export type ScrimNightMatchAccess = AccessResult<{ night: ScrimNight; checkedIn: number[] }>;

/** Gate for creating a night's next match: check-in open, and the requester checked in or an admin. */
export async function requireScrimNightMatchAccess(id: string, now: Date = new Date()): Promise<ScrimNightMatchAccess> {
  const found = await findCurrentNightForPlayer(id, now);
  if (!found.ok) return found;
  const { night, playerId, admin } = found;
  if (!isScrimCheckInOpen(night, now)) {
    return { ok: false, status: 409, error: 'Matches can only be made once check-in is open' };
  }
  const checkedIn = await checkedInPlayerIds(night.id);
  if (!admin && !checkedIn.includes(playerId)) {
    return { ok: false, status: 403, error: 'Check in to make matches' };
  }
  return { ok: true, night, checkedIn };
}

/** Gate for ending a night early: it has started, the requester is signed up for it or an admin, and no
 *  match is still waiting for the server (finish or discard it first). */
export async function requireScrimNightEndAccess(id: string, now: Date = new Date()): Promise<AccessResult<{ night: ScrimNight }>> {
  const found = await findCurrentNightForPlayer(id, now);
  if (!found.ok) return found;
  const { night, playerId, admin } = found;
  if (!hasScrimNightStarted(night, now)) return { ok: false, status: 409, error: 'That night has not started yet' };
  const [signedUp, matches] = await Promise.all([isSignedUp(night.id, playerId), getScrimNightMatches(night.id)]);
  if (!admin && !signedUp) {
    return { ok: false, status: 403, error: 'Only players on the night can end it' };
  }
  if (matches.some(scrimMatchNeedsServer)) {
    return { ok: false, status: 409, error: "Finish or discard the night's waiting matches first" };
  }
  return { ok: true, night };
}

/** Gate for reopening a night that is over, like End night's: the requester is signed up for it or an
 *  admin, and it is still reopenable (`canReopenScrimNight()`). Whether another night holds the server
 *  is `reopen_scrim_night()`'s check. */
export async function requireScrimNightReopenAccess(id: string, now: Date = new Date()): Promise<AccessResult<{ night: ScrimNight }>> {
  const found = await findNightForPlayer(() => findScrimNight(id));
  if (!found.ok) return found;
  const { night, playerId, admin } = found;
  if (!admin && !(await isSignedUp(night.id, playerId))) {
    return { ok: false, status: 403, error: 'Only players on the night can reopen it' };
  }
  if (!canReopenScrimNight(night, now)) {
    const over = hasScrimNightEnded(night, now);
    return { ok: false, status: 409, error: over ? 'That night is too long ago to reopen' : 'That night is still on' };
  }
  return { ok: true, night };
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
