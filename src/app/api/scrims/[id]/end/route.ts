// Ends a scrim night now (`POST`), ahead of the clock: its signups, check-in and lobby close and the
// page turns to results. Open to anyone signed up for the night or an admin, once it has started and
// no match is waiting for the server (`requireScrimNightEndAccess()`).

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied } from '@/lib/access-control';
import { internalError } from '@/lib/route-errors';
import { requireScrimNightEndAccess } from '@/lib/scrim-match-access';
import { endScrimNight } from '@/lib/scrim-nights';
import { afterBestEffort } from '@/lib/after';
import { syncScrimNightMessage } from '@/lib/discord-scrim-notify';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireScrimNightEndAccess((await params).id);
  if (!access.ok) return accessDenied(access);

  try {
    const db = getAdminClient();
    await endScrimNight(db, access.night.id);
    // The night's Discord message turns to its final standings.
    afterBestEffort('syncScrimNightMessage', () => syncScrimNightMessage(db, access.night.id));
  } catch (err) {
    return internalError(err, 'Ending the night failed');
  }
  return NextResponse.json({ ok: true });
}
