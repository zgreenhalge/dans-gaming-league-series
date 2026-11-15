// Ends a scrim night now (`POST`), ahead of the clock: its signups, check-in and lobby close and the
// page turns to results. Open to anyone signed up for the night or an admin, once it has started and
// no match is waiting for the server (`requireScrimNightEndAccess()`).

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied, writeFailed } from '@/lib/access-control';
import { requireScrimNightEndAccess } from '@/lib/scrim-match-access';
import { endScrimNight } from '@/lib/scrim-nights';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireScrimNightEndAccess((await params).id);
  if (!access.ok) return accessDenied(access);

  try {
    await endScrimNight(getAdminClient(), access.night.id);
  } catch (err) {
    return writeFailed(err, 'Ending the night failed');
  }
  return NextResponse.json({ ok: true });
}
