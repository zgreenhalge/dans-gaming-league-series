// Read a match's live in-match score (Phase 2 of the pull-based demo pipeline). Public — the match
// page itself is public, so this mirrors that rather than gating behind `requireMatchAccess` the way
// mutation-adjacent demo/server routes do. Sourced from `going_live`/`round_end`/`map_result` events
// written by `/api/ingest/matchzy-log` — see `src/lib/demo/liveScore.ts`.

import { NextRequest, NextResponse } from 'next/server';
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

  const liveScore = await getLiveScore(matchId);
  return NextResponse.json({ liveScore });
}
