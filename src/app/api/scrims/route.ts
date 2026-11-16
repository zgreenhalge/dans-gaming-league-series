// Starts a scrim night (`POST { startsAt, commitment, player_id }`): the night is created with that
// player as its first signup (`startScrimNight()`). Admin-or-self (`requireScrimSignupTarget()`).
// 409 when its slot meets another night's: one still running at `startsAt`, or starting within `SCRIM_NIGHT_IDLE_MS` of it.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied } from '@/lib/access-control';
import { internalError } from '@/lib/route-errors';
import { requireScrimSignupTarget } from '@/lib/scrim-signup-access';
import { parseCommitment, parseNightStart } from '@/lib/scrim-schedule';
import { OverlappingScrimNightError, startScrimNight } from '@/lib/scrim-nights';
import { getPlayersById } from '@/lib/queries';
import { afterBestEffort } from '@/lib/after';
import { notifyScrimNightScheduled, scheduleScrimNightReminder } from '@/lib/discord-scrim-notify';

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
    const db = getAdminClient();
    const nightId = await startScrimNight(db, start.startsAt, access.targetPlayerId, commitment);
    // Deferred past the response: announce the night in Discord and queue its 1-hour reminder.
    afterBestEffort('announceScrimNight', () =>
      Promise.all([notifyScrimNightScheduled(db, nightId), scheduleScrimNightReminder(db, nightId, start.startsAt)]),
    );
    return NextResponse.json({ ok: true, nightId }, { status: 201 });
  } catch (err) {
    if (err instanceof OverlappingScrimNightError) return NextResponse.json({ error: err.message }, { status: 409 });
    return internalError(err, 'Starting the night failed');
  }
}
