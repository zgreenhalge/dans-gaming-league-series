// Checks a player in to a scrim night (`POST { player_id }`) or out again (`DELETE { player_id }`).
// Admin-or-self (`requireScrimSignupAccess()`), and only while check-in is open
// (`isScrimCheckInOpen()`: from shortly before the start until the night ends). Checking in signs up
// a player who hadn't, as definite.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied } from '@/lib/access-control';
import { requireScrimSignupAccess } from '@/lib/scrim-signup-access';
import { isScrimCheckInOpen } from '@/lib/scrim-schedule';
import { setScrimCheckIn } from '@/lib/scrim-nights';
import { getPlayersById } from '@/lib/queries';

async function handle(req: NextRequest, params: Promise<{ id: string }>, checkedIn: boolean) {
  const now = new Date();
  const access = await requireScrimSignupAccess(req, (await params).id, now);
  if (!access.ok) return accessDenied(access);
  if (!isScrimCheckInOpen(access.night, now)) {
    return NextResponse.json({ error: 'Check-in is not open for that night' }, { status: 409 });
  }
  if (checkedIn && !(await getPlayersById()).has(access.targetPlayerId)) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  }

  try {
    await setScrimCheckIn(getAdminClient(), access.night.id, access.targetPlayerId, checkedIn);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Check-in failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, params, true);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, params, false);
}
