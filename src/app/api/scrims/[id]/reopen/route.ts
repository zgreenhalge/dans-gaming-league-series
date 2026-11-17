// Reopens a scrim night that is over (`POST`), so it is current again: signups, check-in and the lobby
// open until it is ended or goes idle. Open to anyone signed up for the night or an admin, while it is
// still reopenable (`requireScrimNightReopenAccess()`); 409 while another night holds the shared server
// (`reopen_scrim_night()`), or when a concurrent reopen already got there.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied } from '@/lib/access-control';
import { internalError } from '@/lib/route-errors';
import { requireScrimNightReopenAccess } from '@/lib/scrim-match-access';
import { CurrentScrimNightError, reopenScrimNight, ScrimNightNotOverError } from '@/lib/scrim-nights';
import { afterBestEffort } from '@/lib/after';
import { syncScrimNightMessage } from '@/lib/discord-scrim-notify';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireScrimNightReopenAccess((await params).id);
  if (!access.ok) return accessDenied(access);

  try {
    const db = getAdminClient();
    await reopenScrimNight(db, access.night.id);
    // The night's Discord message goes back from its final standings to the latest match.
    afterBestEffort('syncScrimNightMessage', () => syncScrimNightMessage(db, access.night.id));
  } catch (err) {
    if (err instanceof CurrentScrimNightError || err instanceof ScrimNightNotOverError) return NextResponse.json({ error: err.message }, { status: 409 });
    return internalError(err, 'Reopening the night failed');
  }
  return NextResponse.json({ ok: true });
}
