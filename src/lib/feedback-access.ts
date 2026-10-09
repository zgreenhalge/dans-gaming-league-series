// Session gates for the post-season survey and the superlatives vote. Both take the raw `[id]` route
// segment and return the parsed `seasonId` with the gate's result, so a handler opens with one call
// instead of its own parse/validate/gate preamble. The season must be a regular one. The admin flag
// doesn't bypass the player gate's eligibility check — an admin who didn't play can set a survey up
// and read its results but doesn't get a response of their own.

import { requireSession } from './session';
import { requireAdminAccess } from './admin-access';
import { getAdminClient } from './supabase-admin';
import { getSeason, getSeasonPlayedPlayers, hasPlayedSeason } from './queries';
import { parseRouteId } from './util';
import type { SeasonRosterEntry } from './queries';
import type { AccessResult } from './access-control';

type SupabaseAdmin = ReturnType<typeof getAdminClient>;

export type SeasonFeedbackAccess = AccessResult<{
  seasonId: number;
  supabaseAdmin: SupabaseAdmin;
  playerId: number;
  /** Everyone who played in the season — the valid superlative nominees. */
  eligible: SeasonRosterEntry[];
}>;

/** Player gate: the caller must be signed in and have played in the season. */
export async function requireSeasonFeedbackAccess(rawSeasonId: string): Promise<SeasonFeedbackAccess> {
  const seasonId = parseRouteId(rawSeasonId);
  if (seasonId == null) return { ok: false, status: 400, error: 'Invalid season id' };

  const session = await requireSession();
  const playerId = session?.user?.playerId;
  if (!playerId) return { ok: false, status: 401, error: 'Unauthorized' };

  const season = await getSeason(seasonId);
  if (!season || season.is_gauntlet) return { ok: false, status: 404, error: 'Regular season not found' };

  const eligible = await getSeasonPlayedPlayers(seasonId);
  if (!hasPlayedSeason(eligible, playerId)) {
    return { ok: false, status: 403, error: 'Only players who played this season can respond' };
  }
  return { ok: true, seasonId, supabaseAdmin: getAdminClient(), playerId, eligible };
}

export type SeasonFeedbackAdminAccess = AccessResult<{ seasonId: number; supabaseAdmin: SupabaseAdmin }>;

/** Admin gate for setting up and controlling a season's survey or superlatives. No eligibility
 *  check — admins manage these for seasons they may not have played in. */
export async function requireSeasonFeedbackAdmin(rawSeasonId: string): Promise<SeasonFeedbackAdminAccess> {
  const seasonId = parseRouteId(rawSeasonId);
  if (seasonId == null) return { ok: false, status: 400, error: 'Invalid season id' };

  const access = await requireAdminAccess();
  if (!access.ok) return access;
  const season = await getSeason(seasonId);
  if (!season || season.is_gauntlet) return { ok: false, status: 404, error: 'Regular season not found' };
  return { ok: true, seasonId, supabaseAdmin: getAdminClient() };
}
