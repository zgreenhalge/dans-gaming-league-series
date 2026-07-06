import { after, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { triggerRatingRecompute } from '@/lib/ehog-recompute';

// Admin "recompute now" (#144). EHOG ratings recompute automatically on every score write; this
// lets an admin force a full walk on demand (e.g. after a manual data fix). Fire-and-forget in
// `after()` so the response returns immediately while the walk runs in the background — the caller
// just needs to know it was kicked off, not wait for it.

const supabaseAdmin = getAdminClient();

export async function POST() {
  const session = await getServerSession(authOptions);
  const playerId = session?.user?.playerId;
  if (!playerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: playerRow } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', playerId)
    .maybeSingle();
  if (!(playerRow as { is_admin?: boolean } | null)?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!process.env.RECOMPUTE_SECRET) {
    return NextResponse.json({ error: 'Recompute not configured (RECOMPUTE_SECRET missing)' }, { status: 500 });
  }

  after(() => triggerRatingRecompute());
  return NextResponse.json({ ok: true });
}
