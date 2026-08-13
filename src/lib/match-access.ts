// Shared session gate for match-scoped mutations: the caller must be a site admin or a player in
// the match. Composes the existing auth (next-auth session + `players.is_admin`) — it does not modify
// auth logic. Used by the demo upload-url / result and server provision/status/teardown routes.

import { requireSession } from './session';
import { getAdminClient } from './supabase-admin';
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
