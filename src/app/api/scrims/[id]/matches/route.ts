// Makes a scrim night's next match: `pickNextScrimMatch()` over the checked-in players (by current
// EHOG, against the night's earlier matches) on a random map from every map the server can load.
// Any checked-in player or an admin, once check-in is open (`requireScrimNightMatchAccess()`). 409
// while fewer than four are checked in, or while the night has a match without a score.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied } from '@/lib/access-control';
import { requireScrimNightMatchAccess } from '@/lib/scrim-match-access';
import { getMapsForWorkshopPicker, getPlayerRatings, getScrimNightMatches } from '@/lib/queries';
import { pickNextScrimMatch } from '@/lib/scrim-matchmaking';
import { SCRIM_MATCH_SIZE } from '@/lib/scrim-schedule';
import { queueScrimMatches, ScrimMatchConflictError } from '@/lib/scrim-matches';

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
    if (err instanceof ScrimMatchConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Making the match failed' }, { status: 500 });
  }
}
