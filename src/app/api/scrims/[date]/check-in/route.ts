// Checks a player in to a scrim night (`POST { player_id }`) or out again (`DELETE { player_id }`).
// Admin-or-self (`requireScrimSignupAccess()`), and only while check-in is open
// (`isScrimCheckInOpen()`: from shortly before the start until the night ends, never for a cancelled
// night). Checking in signs up a player who hadn't, as definite.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied } from '@/lib/access-control';
import { requireScrimSignupAccess } from '@/lib/scrim-signup-access';
import { isScrimCheckInOpen } from '@/lib/scrim-schedule';
import { ensureScrimNight, setScrimCheckIn } from '@/lib/scrim-nights';
import { getPlayersById } from '@/lib/queries';

async function handle(req: NextRequest, params: Promise<{ date: string }>, checkedIn: boolean) {
  const { date } = await params;
  const now = new Date();
  const access = await requireScrimSignupAccess(req, date, now);
  if (!access.ok) return accessDenied(access);
  if (!isScrimCheckInOpen(access.slot, now)) {
    return NextResponse.json({ error: 'Check-in is not open for that night' }, { status: 409 });
  }
  if (checkedIn && !(await getPlayersById()).has(access.targetPlayerId)) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  }
  // Checking out of a night nobody has signed up for has nothing to change.
  if (!checkedIn && access.slot.nightId === null) return NextResponse.json({ ok: true });

  const db = getAdminClient();
  try {
    const nightId = access.slot.nightId ?? (await ensureScrimNight(db, date));
    await setScrimCheckIn(db, nightId, access.targetPlayerId, checkedIn);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Check-in failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  return handle(req, params, true);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  return handle(req, params, false);
}
