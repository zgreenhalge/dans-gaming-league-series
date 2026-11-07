// Shared session gate for match-scoped mutations: the caller must be a site admin or a player in
// the match, checked against the next-auth session and `players.is_admin`. Used by the match-scoped
// mutation routes (score, veto, schedule, recording, demo, replay dispatch, server provision/status/
// teardown).

import { requireSession } from './session';
import { getAdminClient } from './supabase-admin';
import { isScrimMatch } from './scrim-matches';
import type { AccessResult } from './access-control';

export type MatchAccess = AccessResult<{ playerId: number; isAdmin: boolean }>;

export async function requireMatchAccess(matchId: number): Promise<MatchAccess> {
  const session = await requireSession();
  const playerId = session?.user?.playerId;
  if (!playerId) return { ok: false, status: 401, error: 'Unauthorized' };

  const supabaseAdmin = getAdminClient();
  const [{ data: playerRow }, { data: matchStats }] = await Promise.all([
    supabaseAdmin.from('players').select('is_admin').eq('id', playerId).maybeSingle(),
    supabaseAdmin.from('player_match_stats').select('player_id').eq('match_id', matchId),
  ]);

  const isAdmin = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
  const isInMatch = (matchStats ?? []).some((s) => s.player_id === playerId);
  if (!isAdmin && !isInMatch) return { ok: false, status: 403, error: 'Forbidden' };

  return { ok: true, playerId, isAdmin };
}

/** Gate for reading a match's server status (its state and connect string). Anyone signed in may read
 *  a scrim match's, so a spectator can join the server; a league match's stays admin-or-in-match. */
export async function requireServerStatusAccess(matchId: number): Promise<MatchAccess> {
  const access = await requireMatchAccess(matchId);
  // 403 is a signed-in player who is neither an admin nor in the match; 401 and the rest stand.
  if (access.ok || access.status !== 403) return access;
  if (!(await isScrimMatch(getAdminClient(), matchId))) return access;
  const playerId = (await requireSession())?.user?.playerId;
  return playerId ? { ok: true, playerId, isAdmin: false } : access;
}
