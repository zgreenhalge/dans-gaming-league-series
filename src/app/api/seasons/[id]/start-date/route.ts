import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';

const supabaseAdmin = getAdminClient();

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const { data: playerRow } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', session.user.playerId)
    .maybeSingle();

  if (!(playerRow as { is_admin?: boolean } | null)?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !('start_date' in body)) {
    return NextResponse.json({ error: 'Missing start_date' }, { status: 400 });
  }

  const start_date: string | null = body.start_date ?? null;

  if (start_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
    return NextResponse.json({ error: 'Invalid date format (expected YYYY-MM-DD)' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('seasons')
    .update({ start_date })
    .eq('id', seasonId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
