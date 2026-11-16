// Signs a player up for a scrim night (`POST { player_id, commitment: 'definite' | 'maybe' }` — again
// to change their commitment) or drops them (`DELETE { player_id }`, answering `{ nightRemoved }`:
// the last player out of a night with no matches removes it). Admin-or-self, open until the night
// ends — see `requireScrimSignupAccess()`. Each change updates the night's Discord roster
// (`discord-scrim-notify.ts`); removing the night deletes its messages. A night is started by its first signup through
// `POST /api/scrims`.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied } from '@/lib/access-control';
import { internalError } from '@/lib/route-errors';
import { requireScrimSignupAccess } from '@/lib/scrim-signup-access';
import { parseCommitment } from '@/lib/scrim-schedule';
import { leaveScrimNight, setScrimSignup } from '@/lib/scrim-nights';
import { getPlayersById } from '@/lib/queries';
import { afterBestEffort } from '@/lib/after';
import { deleteScrimNightMessages, getScrimNightMessageIds, syncScrimNightMessage } from '@/lib/discord-scrim-notify';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireScrimSignupAccess(req, (await params).id);
  if (!access.ok) return accessDenied(access);

  const commitment = parseCommitment((access.body as { commitment?: unknown } | null)?.commitment);
  if (!commitment) return NextResponse.json({ error: "commitment must be 'definite' or 'maybe'" }, { status: 400 });
  if (!(await getPlayersById()).has(access.targetPlayerId)) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  }

  try {
    const db = getAdminClient();
    await setScrimSignup(db, access.night.id, access.targetPlayerId, commitment);
    afterBestEffort('syncScrimNightMessage', () => syncScrimNightMessage(db, access.night.id));
  } catch (err) {
    return internalError(err, 'Signup failed');
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireScrimSignupAccess(req, (await params).id);
  if (!access.ok) return accessDenied(access);

  try {
    const db = getAdminClient();
    // The night's state row (and its message ids) goes with the night, so read them first.
    const messageIds = await getScrimNightMessageIds(db, access.night.id);
    const nightRemoved = await leaveScrimNight(db, access.night.id, access.targetPlayerId);
    afterBestEffort('syncScrimNightMessage', () =>
      nightRemoved ? deleteScrimNightMessages(access.night.id, messageIds) : syncScrimNightMessage(db, access.night.id),
    );
    return NextResponse.json({ ok: true, nightRemoved });
  } catch (err) {
    return internalError(err, 'Dropping out failed');
  }
}
