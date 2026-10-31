// Signs a player up for a scrim night (`POST { player_id, commitment: 'definite' | 'maybe' }` — again
// to change their commitment) or drops them (`DELETE { player_id }`). Admin-or-self, open until the
// night ends — see `requireScrimSignupAccess()`.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied } from '@/lib/access-control';
import { requireScrimSignupAccess } from '@/lib/scrim-signup-access';
import { parseCommitment } from '@/lib/scrim-schedule';
import { ensureScrimNight, removeScrimSignup, setScrimSignup } from '@/lib/scrim-nights';

export async function POST(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const access = await requireScrimSignupAccess(req, date);
  if (!access.ok) return accessDenied(access);

  const commitment = parseCommitment((access.body as { commitment?: unknown } | null)?.commitment);
  if (!commitment) return NextResponse.json({ error: "commitment must be 'definite' or 'maybe'" }, { status: 400 });

  const db = getAdminClient();
  try {
    const nightId = access.slot.nightId ?? (await ensureScrimNight(db, date));
    await setScrimSignup(db, nightId, access.targetPlayerId, commitment);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Signup failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const access = await requireScrimSignupAccess(req, date);
  if (!access.ok) return accessDenied(access);

  // No row yet means nobody has signed up for this night, so there's nothing to drop.
  if (access.slot.nightId === null) return NextResponse.json({ ok: true });
  try {
    await removeScrimSignup(getAdminClient(), access.slot.nightId, access.targetPlayerId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Dropping out failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
