import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { getPlayerNameHistory } from '@/lib/queries';

// Admin-only read of a player's past renames (issue #268), logged by both the self-service and
// admin rename routes to the same `player_name_history` table. Surfaced on /admin/players for
// moderation/audit — not exposed publicly.

const supabaseAdmin = getAdminClient();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  const callerId = session?.user?.playerId;
  if (!callerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: callerRow } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', callerId)
    .maybeSingle();
  if (!(callerRow as { is_admin?: boolean } | null)?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'Invalid player ID' }, { status: 400 });
  }

  const history = await getPlayerNameHistory(targetId);
  return NextResponse.json({ history });
}
