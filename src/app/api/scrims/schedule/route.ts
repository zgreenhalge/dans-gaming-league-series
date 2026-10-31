// Sets the weekly scrim slot (day, start time, timezone, on/off). Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { accessDenied } from '@/lib/access-control';
import { getAdminClient } from '@/lib/supabase-admin';
import { parseScrimScheduleInput } from '@/lib/scrim-schedule';
import { saveScrimSchedule } from '@/lib/scrim-nights';

export async function PUT(req: NextRequest) {
  const access = await requireAdminAccess();
  if (!access.ok) return accessDenied(access);

  const parsed = parseScrimScheduleInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    await saveScrimSchedule(getAdminClient(), parsed.schedule);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Saving the schedule failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
