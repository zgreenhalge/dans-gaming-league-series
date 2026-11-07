// Starts a scrim night (`POST { startsAt, commitment, player_id }`): the night is created with that
// player as its first signup (`startScrimNight()`). Admin-or-self (`requireScrimSignupTarget()`).
// 409 when another night is still running at `startsAt` or starts within `SCRIM_NIGHT_LENGTH_MS` after it.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied } from '@/lib/access-control';
import { requireScrimSignupTarget } from '@/lib/scrim-signup-access';
import { parseCommitment, parseNightStart } from '@/lib/scrim-schedule';
import { OverlappingScrimNightError, startScrimNight } from '@/lib/scrim-nights';
import { getPlayersById } from '@/lib/queries';

export async function POST(req: NextRequest) {
  const access = await requireScrimSignupTarget(req);
  if (!access.ok) return accessDenied(access);

  const body = access.body as { commitment?: unknown; startsAt?: unknown } | null;
  const commitment = parseCommitment(body?.commitment);
  if (!commitment) return NextResponse.json({ error: "commitment must be 'definite' or 'maybe'" }, { status: 400 });
  const start = parseNightStart(body?.startsAt, new Date());
  if (!start.ok) return NextResponse.json({ error: start.error }, { status: 400 });
  if (!(await getPlayersById()).has(access.targetPlayerId)) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  }

  try {
    const nightId = await startScrimNight(getAdminClient(), start.startsAt, access.targetPlayerId, commitment);
    return NextResponse.json({ ok: true, nightId }, { status: 201 });
  } catch (err) {
    if (err instanceof OverlappingScrimNightError) return NextResponse.json({ error: err.message }, { status: 409 });
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Starting the night failed' }, { status: 500 });
  }
}
