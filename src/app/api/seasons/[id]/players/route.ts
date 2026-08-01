import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { isPlayerAdmin } from '@/lib/queries';

type Access =
  | { ok: true; supabaseAdmin: ReturnType<typeof getAdminClient>; targetPlayerId: number }
  | { ok: false; status: number; error: string };

/** Maps the `season_players_upcoming_only` trigger's raised exception (Postgres default SQLSTATE
 * P0001) to the same 400 `resolveAccess()` returns for the non-racing case, and everything else to
 * a 500. The trigger — not this file's pre-check — is what makes the UPCOMING gate atomic: it
 * row-locks the season and re-verifies status inside the same transaction as the season_players
 * write, closing the TOCTOU window between resolveAccess()'s read and the write below it. */
function mapWriteError(error: { code?: string; message: string }): NextResponse {
  if (error.code === 'P0001') {
    return NextResponse.json({ error: 'Roster can only be edited while the season is UPCOMING' }, { status: 400 });
  }
  return NextResponse.json({ error: error.message }, { status: 500 });
}

// Admins can add/remove any player; a player can only add/remove themselves. Either way, the
// roster is only editable while the season hasn't started — once it's ACTIVE, participation is
// tracked through player_match_stats instead. This pre-check is a fast, friendly rejection for the
// common (non-racing) case; the `season_players_upcoming_only` DB trigger is the atomic source of
// truth that closes the race between this read and the write in POST/DELETE below.
async function resolveAccess(req: NextRequest, seasonId: number): Promise<Access> {
  const session = await getServerSession(authOptions);
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) return NextResponse.json({ error: 'Invalid season id' }, { status: 400 });

  const access = await resolveAccess(req, seasonId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { data: player, error: playerErr } = await access.supabaseAdmin
    .from('players')
    .select('id')
    .eq('id', access.targetPlayerId)
    .maybeSingle();
  if (playerErr) return NextResponse.json({ error: playerErr.message }, { status: 500 });
  if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  const { error: insertErr } = await access.supabaseAdmin
    .from('season_players')
    .insert({ season_id: seasonId, player_id: access.targetPlayerId });
  if (insertErr && (insertErr as { code?: string }).code !== '23505') {
    return mapWriteError(insertErr as { code?: string; message: string });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) return NextResponse.json({ error: 'Invalid season id' }, { status: 400 });

  const access = await resolveAccess(req, seasonId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { error: deleteErr } = await access.supabaseAdmin
    .from('season_players')
    .delete()
    .eq('season_id', seasonId)
    .eq('player_id', access.targetPlayerId);
  if (deleteErr) return mapWriteError(deleteErr as { code?: string; message: string });

  return NextResponse.json({ ok: true });
}
