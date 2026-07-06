import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { parseMatchId } from '@/lib/util';

// Set a match's `is_feature_match` flag. Admin-only — feature status is an editorial call (which match
// the league spotlights), not something an in-match player should flip, so this doesn't use the
// in-match fallback the schedule/score routes allow.

const supabaseAdmin = getAdminClient();

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  const playerId = session?.user?.playerId;
  if (!playerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const matchId = parseMatchId(id);
  if (matchId === null) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const { data: playerRow } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', playerId)
    .maybeSingle();
  if (!(playerRow as { is_admin?: boolean } | null)?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.is_feature_match !== 'boolean') {
    return NextResponse.json({ error: 'Missing boolean is_feature_match' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('matches')
    .update({ is_feature_match: body.is_feature_match })
    .eq('id', matchId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, is_feature_match: body.is_feature_match });
}
