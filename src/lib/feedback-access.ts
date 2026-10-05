// Shared session gate for the post-season survey and the superlatives vote: the caller must be
// signed in, the season must be a regular season, and the caller must have played in it. The admin
// flag doesn't bypass the eligibility check — an admin who didn't play can set a survey up and read
// its results but doesn't get a response of their own. Mirrors `season-roster-access.ts`'s shape
// (one small gate file per access shape, returning the shared `AccessResult<T>`).

import { requireSession } from './session';
import { requireAdminAccess } from './admin-access';
import { getAdminClient } from './supabase-admin';
import { getSeason, getSeasonPlayedPlayers } from './queries';
import type { SeasonRosterEntry } from './queries';
import type { AccessResult } from './access-control';

export type SeasonFeedbackEligibility = AccessResult<{
  playerId: number;
  /** Everyone who played in the season — the valid superlative nominees. */
  eligible: SeasonRosterEntry[];
}>;

/** The access rules without the session read, so a Server Component page (which reads the session
 *  via `getSession()`) and a route handler (`requireSession()`) apply the identical check. */
export async function checkSeasonFeedbackEligibility(seasonId: number, playerId: number | null | undefined): Promise<SeasonFeedbackEligibility> {
  if (!playerId) return { ok: false, status: 401, error: 'Unauthorized' };

  const season = await getSeason(seasonId);
  if (!season || season.is_gauntlet) return { ok: false, status: 404, error: 'Regular season not found' };

  const eligible = await getSeasonPlayedPlayers(seasonId);
  if (!eligible.some((p) => p.player_id === playerId)) {
    return { ok: false, status: 403, error: 'Only players who played this season can respond' };
  }
  return { ok: true, playerId, eligible };
}

export type SeasonFeedbackAccess = AccessResult<{
  supabaseAdmin: ReturnType<typeof getAdminClient>;
  playerId: number;
  eligible: SeasonRosterEntry[];
}>;

export async function requireSeasonFeedbackAccess(seasonId: number): Promise<SeasonFeedbackAccess> {
  const session = await requireSession();
  const eligibility = await checkSeasonFeedbackEligibility(seasonId, session?.user?.playerId);
  if (!eligibility.ok) return eligibility;
  return { ...eligibility, supabaseAdmin: getAdminClient() };
}

export type SeasonFeedbackAdminAccess = AccessResult<{ supabaseAdmin: ReturnType<typeof getAdminClient> }>;

/** Admin gate for setting up and controlling a season's survey or superlatives: the caller must be
 *  an admin and the season must be a regular one. No eligibility check — admins manage these for
 *  seasons they may not have played in. */
export async function requireSeasonFeedbackAdmin(seasonId: number): Promise<SeasonFeedbackAdminAccess> {
  const access = await requireAdminAccess();
  if (!access.ok) return access;
  const season = await getSeason(seasonId);
  if (!season || season.is_gauntlet) return { ok: false, status: 404, error: 'Regular season not found' };
  return { ok: true, supabaseAdmin: getAdminClient() };
}
