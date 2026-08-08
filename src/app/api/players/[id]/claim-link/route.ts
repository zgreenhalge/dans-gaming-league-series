import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { signPlayerClaim } from '@/lib/playerClaim';

// Mints a signed claim link (#322) for an unlinked player, so an admin can hand it to the actual
// person out of band (Discord, text) instead of self-service registration trusting a caller's
// unverified choice of `existingPlayerId`.

const supabaseAdmin = getAdminClient();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { id } = await params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'Invalid player ID' }, { status: 400 });
  }

  const { data: player, error } = await supabaseAdmin
    .from('players')
    .select('id, name, steam_id')
    .eq('id', targetId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  const row = player as { id: number; name: string; steam_id: string | null };
  if (row.steam_id) {
    return NextResponse.json({ error: 'Player is already linked.' }, { status: 400 });
  }

  const token = signPlayerClaim(row.id, row.name);
  return NextResponse.json({ token });
}
