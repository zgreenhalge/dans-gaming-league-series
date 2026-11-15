// Makes a scrim night's next match: `pickNextScrimMatch()` over the checked-in players (by current
// EHOG, against the night's earlier matches) on a random map from every map the server can load.
// Any checked-in player or an admin, once check-in is open (`requireScrimNightMatchAccess()`). 409
// while fewer than four are checked in, or while the night has a match that still needs the server
// (`scrimMatchNeedsServer()`: no score, and its server hasn't stopped).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied, writeFailed } from '@/lib/access-control';
import { requireScrimNightMatchAccess } from '@/lib/scrim-match-access';
import { getMapsForWorkshopPicker, getPlayerRatings, getScrimNightMatches } from '@/lib/queries';
import { pickNextScrimMatch } from '@/lib/scrim-matchmaking';
import { SCRIM_MATCH_SIZE } from '@/lib/scrim-schedule';
import { queueScrimMatches } from '@/lib/scrim-matches';
import { scrimConflictResponse } from '@/lib/scrim-route-errors';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireScrimNightMatchAccess((await params).id);
  if (!access.ok) return accessDenied(access);
  const { night, checkedIn } = access;

  const [ratings, history, maps] = await Promise.all([
    getPlayerRatings(checkedIn),
    getScrimNightMatches(night.id),
    getMapsForWorkshopPicker(),
  ]);

  const plan = pickNextScrimMatch(ratings, history);
  if (!plan) return NextResponse.json({ error: `A match needs ${SCRIM_MATCH_SIZE} checked-in players` }, { status: 409 });

  try {
    const [matchId] = await queueScrimMatches(getAdminClient(), night.id, [plan], maps);
    return NextResponse.json({ ok: true, matchId }, { status: 201 });
  } catch (err) {
    const conflict = scrimConflictResponse(err);
    if (conflict) return conflict;
    return writeFailed(err, 'Making the match failed');
  }
}
