// Reopens a scrim night that is over (`POST`), so it is current again: signups, check-in and the lobby
// open until it is ended or goes idle. Open to anyone signed up for the night or an admin, while it is
// still reopenable (`requireScrimNightReopenAccess()`); 409 while another night holds the shared server
// (`reopen_scrim_night()`), or when a concurrent reopen already got there.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied, writeFailed } from '@/lib/access-control';
import { requireScrimNightReopenAccess } from '@/lib/scrim-match-access';
import { CurrentScrimNightError, reopenScrimNight, ScrimNightNotOverError } from '@/lib/scrim-nights';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireScrimNightReopenAccess((await params).id);
  if (!access.ok) return accessDenied(access);

  try {
    await reopenScrimNight(getAdminClient(), access.night.id);
  } catch (err) {
    if (err instanceof CurrentScrimNightError || err instanceof ScrimNightNotOverError) return NextResponse.json({ error: err.message }, { status: 409 });
    return writeFailed(err, 'Reopening the night failed');
  }
  return NextResponse.json({ ok: true });
}
