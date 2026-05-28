import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createClient } from '@supabase/supabase-js';
import { authOptions } from '@/lib/authOptions';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const playerId = session.user.playerId;

  // Resolve match → week → season in parallel with the admin check
  const [{ data: matchRow }, { data: playerRow }] = await Promise.all([
    supabaseAdmin
      .from('matches')
      .select('week_id, weeks(seasons(is_gauntlet))')
      .eq('id', matchId)
      .maybeSingle(),
    supabaseAdmin.from('players').select('is_admin').eq('id', playerId).maybeSingle(),
  ]);

  if (!matchRow) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 });
  }

  const isAdmin = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isGauntlet =
    (matchRow as { weeks?: { seasons?: { is_gauntlet?: boolean } } } | null)
      ?.weeks?.seasons?.is_gauntlet ?? false;
  if (isGauntlet) {
    return NextResponse.json({ error: 'Cannot schedule gauntlet matches' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !('scheduled_at' in body)) {
    return NextResponse.json({ error: 'Missing scheduled_at' }, { status: 400 });
  }

  const scheduled_at: string | null = body.scheduled_at ?? null;

  if (scheduled_at !== null && isNaN(Date.parse(scheduled_at))) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('matches')
    .update({ scheduled_at })
    .eq('id', matchId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
