import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { isPlayerAdmin } from '@/lib/queries';

type Access =
  | { ok: true; supabaseAdmin: ReturnType<typeof getAdminClient>; targetPlayerId: number }
  | { ok: false; status: number; error: string };

// Admins can add/remove any player; a player can only add/remove themselves. Either way, the
// roster is only editable while the season hasn't started — once it's ACTIVE, participation is
// tracked through player_match_stats instead.
async function resolveAccess(req: NextRequest, seasonId: number): Promise<Access> {
  const session = await getServerSession(authOptions);
  const requestingPlayerId = session?.user?.playerId;
  if (!requestingPlayerId) return { ok: false, status: 401, error: 'Unauthorized' };

  const supabaseAdmin = getAdminClient();
  const { data: season, error: seasonErr } = await supabaseAdmin
    .from('seasons')
    .select('status')
    .eq('id', seasonId)
    .maybeSingle();
  if (seasonErr) return { ok: false, status: 500, error: seasonErr.message };
  if (!season) return { ok: false, status: 404, error: 'Season not found' };

  const body = await req.json().catch(() => null);
  const targetPlayerId = Number((body as { player_id?: unknown } | null)?.player_id);
  if (!Number.isFinite(targetPlayerId)) {
    return { ok: false, status: 400, error: 'player_id is required' };
  }

  const admin = await isPlayerAdmin(requestingPlayerId);
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
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
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
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
