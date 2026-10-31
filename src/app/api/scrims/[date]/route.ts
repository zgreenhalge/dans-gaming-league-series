// Cancels or restores one scrim night (`{ cancelled: boolean }`). Admin only, and only for a night
// that hasn't ended yet. Cancelling keeps the night's signups, so restoring brings them back.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { accessDenied } from '@/lib/access-control';
import { getAdminClient } from '@/lib/supabase-admin';
import { getScrimNights } from '@/lib/queries';
import { isNightDate } from '@/lib/scrim-schedule';
import { setScrimNightCancelled } from '@/lib/scrim-nights';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isNightDate(date)) return NextResponse.json({ error: 'Invalid scrim night date' }, { status: 400 });

  const access = await requireAdminAccess();
  if (!access.ok) return accessDenied(access);

  const body = await req.json().catch(() => null);
  const cancelled = (body as { cancelled?: unknown } | null)?.cancelled;
  if (typeof cancelled !== 'boolean') return NextResponse.json({ error: 'cancelled must be a boolean' }, { status: 400 });

  const { slots } = await getScrimNights(new Date());
  if (!slots.some((s) => s.date === date)) {
    return NextResponse.json({ error: 'No upcoming scrim night on that date' }, { status: 404 });
  }

  try {
    await setScrimNightCancelled(getAdminClient(), date, cancelled);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Updating the night failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
