// Read a match's live in-match score. Public — the match page itself is public, so this mirrors that
// rather than gating behind `requireMatchAccess` the way mutation-adjacent demo/server routes do.
// Sourced from the `live_match_score` table, written by `going_live`/`round_end`/`map_result` events
// in `/api/ingest/matchzy-log` (see `src/lib/demo/liveScore.ts`) — this route is only the initial read;
// `LiveScoreTicker` subscribes to the table directly for updates, the same way `MatchServerPanel`
// subscribes to `matches`.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getLiveScore } from '@/lib/demo/liveScore';
import { parseMatchId } from '@/lib/util';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matchId = parseMatchId(id);
  if (matchId === null) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const liveScore = await getLiveScore(getAdminClient(), matchId);
  return NextResponse.json({ liveScore });
}
