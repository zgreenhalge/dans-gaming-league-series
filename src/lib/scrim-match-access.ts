// Session gates for scrim night matches. Creating the night's next match is open to any checked-in
// player or an admin, once check-in is open; ending the night is open to anyone signed up for it or an
// admin, once it has started and no match is waiting for the server. Changing, discarding or starting a
// match is open to the players in it or an admin — the same "admin-or-in-match" shape `requireMatchAccess()` checks
// for every match.

import { requireSession } from './session';
import { requireMatchAccess } from './match-access';
import { isPlayerAdmin, getScrimSignups, getScrimMatch, getScrimNightMatches, type ScrimMatch } from './queries';
import { hasScrimNightStarted, isScrimCheckInOpen, type ScrimNight } from './scrim-schedule';
import { scrimMatchNeedsServer } from './scrim-matches';
import { findCurrentScrimNight } from './scrim-signup-access';
import type { AccessResult } from './access-control';

/** Players checked in to a night — the pool matchmaking and lineup changes draw from. */
export async function checkedInPlayerIds(nightId: number): Promise<number[]> {
  return (await getScrimSignups(nightId)).filter((s) => s.checked_in_at).map((s) => s.player_id);
}

/** The signed-in requester and the night with route param `id`, if it hasn't ended — 401 signed out,
 *  else `findCurrentScrimNight()`'s refusals. */
async function findCurrentNightForPlayer(id: string, now: Date): Promise<AccessResult<{ night: ScrimNight; playerId: number; admin: boolean }>> {
  const session = await requireSession();
  const playerId = session?.user?.playerId;
  if (!playerId) return { ok: false, status: 401, error: 'Unauthorized' };

  const [found, admin] = await Promise.all([findCurrentScrimNight(id, now), isPlayerAdmin(playerId)]);
  if (!found.ok) return found;
  return { ok: true, night: found.night, playerId, admin };
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
  const [signups, matches] = await Promise.all([getScrimSignups(night.id), getScrimNightMatches(night.id)]);
  if (!admin && !signups.some((s) => s.player_id === playerId)) {
    return { ok: false, status: 403, error: 'Only players on the night can end it' };
  }
  if (matches.some(scrimMatchNeedsServer)) {
    return { ok: false, status: 409, error: "Finish or discard the night's waiting matches first" };
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
