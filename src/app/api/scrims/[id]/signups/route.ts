// Signs a player up for a scrim night (`POST { player_id, commitment: 'definite' | 'maybe' }` — again
// to change their commitment) or drops them (`DELETE { player_id }`, answering `{ nightRemoved }`:
// the last player out of a night with no matches removes it). Admin-or-self, open until the night
// ends — see `requireScrimSignupAccess()`. A night is started by its first signup through
// `POST /api/scrims`.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied } from '@/lib/access-control';
import { requireScrimSignupAccess } from '@/lib/scrim-signup-access';
import { parseCommitment } from '@/lib/scrim-schedule';
import { leaveScrimNight, setScrimSignup } from '@/lib/scrim-nights';
import { getPlayersById } from '@/lib/queries';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireScrimSignupAccess(req, (await params).id);
  if (!access.ok) return accessDenied(access);

  const commitment = parseCommitment((access.body as { commitment?: unknown } | null)?.commitment);
  if (!commitment) return NextResponse.json({ error: "commitment must be 'definite' or 'maybe'" }, { status: 400 });
  if (!(await getPlayersById()).has(access.targetPlayerId)) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  }

  try {
    await setScrimSignup(getAdminClient(), access.night.id, access.targetPlayerId, commitment);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Signup failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireScrimSignupAccess(req, (await params).id);
  if (!access.ok) return accessDenied(access);

  try {
    const nightRemoved = await leaveScrimNight(getAdminClient(), access.night.id, access.targetPlayerId);
    return NextResponse.json({ ok: true, nightRemoved });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Dropping out failed' }, { status: 500 });
  }
}
