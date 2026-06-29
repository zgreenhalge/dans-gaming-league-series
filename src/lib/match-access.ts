// Shared session gate for match-scoped mutations: the caller must be a site admin or a player in
// the match. Composes the existing auth (next-auth session + `players.is_admin`) — it does not modify
// auth logic. Mirrors the inline check in `POST /api/matches/[id]/demo/upload-url`.

import { getServerSession } from 'next-auth';
import { authOptions } from './authOptions';
import { getAdminClient } from './supabase-admin';

export type MatchAccess =
  | { ok: true; playerId: number; isAdmin: boolean }
  | { ok: false; status: number; error: string };

export async function requireMatchAccess(matchId: number): Promise<MatchAccess> {
  const session = await getServerSession(authOptions);
  const playerId = session?.user?.playerId;
  if (!playerId) return { ok: false, status: 401, error: 'Unauthorized' };

  const supabaseAdmin = getAdminClient();
  const [{ data: playerRow }, { data: matchStats }] = await Promise.all([
    supabaseAdmin.from('players').select('is_admin').eq('id', playerId).maybeSingle(),
    supabaseAdmin.from('player_match_stats').select('player_id').eq('match_id', matchId),
  ]);

  const isAdmin = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
  const isInMatch = (matchStats ?? []).some((s: { player_id: number }) => s.player_id === playerId);
  if (!isAdmin && !isInMatch) return { ok: false, status: 403, error: 'Forbidden' };

  return { ok: true, playerId, isAdmin };
}
