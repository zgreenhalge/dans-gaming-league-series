// Admin-triggered publish of one week's Discord match threads (#398). No automatic cron — a
// season's start_date is often arbitrary, and so is when an admin actually wants a week's threads
// posted, so this is the only trigger.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { publishWeekThreads } from '@/lib/discord-threads';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const week: number | 'next' = body.week === 'next' ? 'next' : Number(body.week);
  if (week !== 'next' && !Number.isFinite(week)) {
    return NextResponse.json({ error: 'Missing or invalid week' }, { status: 400 });
  }

  const result = await publishWeekThreads(getAdminClient(), seasonId, week);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, ...result });
}
