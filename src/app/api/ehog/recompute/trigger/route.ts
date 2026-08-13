import { after, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { triggerRatingRecompute } from '@/lib/ehog-recompute';

// Admin "recompute now" (#144). EHOG ratings recompute automatically on every score write; this
// lets an admin force a full walk on demand (e.g. after a manual data fix). Fire-and-forget in
// `after()` so the response returns immediately while the walk runs in the background — the caller
// just needs to know it was kicked off, not wait for it.

export async function POST() {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  if (!process.env.RECOMPUTE_SECRET) {
    return NextResponse.json({ error: 'Recompute not configured (RECOMPUTE_SECRET missing)' }, { status: 500 });
  }

  const supabaseAdmin = getAdminClient();
  after(() => triggerRatingRecompute(supabaseAdmin));
  return NextResponse.json({ ok: true });
}
