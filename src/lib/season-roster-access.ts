// Shared session gate for a season's roster edits: an admin can add/remove any player, a player
// can only add/remove themselves. Mirrors admin-access.ts (admin-only) and match-access.ts
// (admin-or-in-match) — this is the "admin-or-self" access shape, kept in its own file for the
// same reason those are: one small dedicated gate file per access shape, rather than reimplemented
// inline at each consumer.

import { NextRequest } from 'next/server';
import { requireSession } from './session';
import { getAdminClient } from './supabase-admin';
import { isPlayerAdmin } from './queries';
import type { AccessResult } from './access-control';

export type SeasonRosterAccess = AccessResult<{
  supabaseAdmin: ReturnType<typeof getAdminClient>;
  targetPlayerId: number;
}>;

// The roster is only editable while the season hasn't started — once it's ACTIVE, participation is
// tracked through player_match_stats instead. This pre-check is a fast, friendly rejection for the
// common (non-racing) case; the `season_players_upcoming_only` DB trigger is the atomic source of
// truth that closes the race between this read and the caller's write.
export async function requireSeasonRosterAccess(req: NextRequest, seasonId: number): Promise<SeasonRosterAccess> {
  const session = await requireSession();
  const requestingPlayerId = session?.user?.playerId;
  if (!requestingPlayerId) return { ok: false, status: 401, error: 'Unauthorized' };

  const supabaseAdmin = getAdminClient();
  // Independent reads — none depends on another's result — so they run concurrently rather than
  // paying three sequential round trips on every roster add/remove.
  const [{ data: season, error: seasonErr }, body, admin] = await Promise.all([
    supabaseAdmin.from('seasons').select('status').eq('id', seasonId).maybeSingle(),
    req.json().catch(() => null),
    isPlayerAdmin(requestingPlayerId),
  ]);
  if (seasonErr) return { ok: false, status: 500, error: seasonErr.message };
  if (!season) return { ok: false, status: 404, error: 'Season not found' };

  const targetPlayerId = Number((body as { player_id?: unknown } | null)?.player_id);
  if (!Number.isFinite(targetPlayerId)) {
    return { ok: false, status: 400, error: 'player_id is required' };
  }

  if (!admin && targetPlayerId !== requestingPlayerId) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  if ((season as { status: string }).status !== 'UPCOMING') {
    return { ok: false, status: 400, error: 'Roster can only be edited while the season is UPCOMING' };
  }

  return { ok: true, supabaseAdmin, targetPlayerId };
}

/** Maps the `season_players_upcoming_only` trigger's raised exception (Postgres default SQLSTATE
 * P0001) to the same 400 `requireSeasonRosterAccess()` returns for the non-racing case, and
 * everything else to a 500. The trigger — not the pre-check above — is what makes the UPCOMING
 * gate atomic: it row-locks the season and re-verifies status inside the same transaction as the
 * season_players write, closing the TOCTOU window between the pre-check's read and that write. */
export function mapSeasonRosterWriteError(error: { code?: string; message: string }) {
  if (error.code === 'P0001') {
    return { error: 'Roster can only be edited while the season is UPCOMING', status: 400 as const };
  }
  return { error: error.message, status: 500 as const };
}
