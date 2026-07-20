import { NextRequest, NextResponse } from 'next/server';
import { getPlayerRoundTraces } from '@/lib/queries';

// Aggregates a player's per-round position trace across the matches the caller
// specifies — the career-wide "replay all of a player's rounds" overlay (#128), a
// sibling to `/api/maps/[slug]/heatmap`. POSTed for the same reason: the player page
// already knows (from `history`, respecting its own season filter) which of the
// player's matches were played on the map in question, so it hands that set straight
// through instead of this route re-deriving it. Runs only when the Pathing tab is
// opened for a chosen map.
//
// `slug` (issue #127) lets `getPlayerRoundTraces` check the map's precomputed trace
// rollup first, falling back progressively (a direct per-match artifact fetch, then
// the full `replay.json` fan-out) only for whatever matches it doesn't cover —
// optional so a caller without a map in hand (there is none today) still gets
// correct, just unaccelerated, results.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isFinite(playerId)) {
    return NextResponse.json({ error: 'Invalid player ID' }, { status: 400 });
  }

  let matchIds: unknown;
  let slug: unknown;
  try {
    ({ matchIds, slug } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(matchIds) || !matchIds.every((mid) => typeof mid === 'number')) {
    return NextResponse.json({ error: 'matchIds must be a number[]' }, { status: 400 });
  }
  if (slug !== undefined && typeof slug !== 'string') {
    return NextResponse.json({ error: 'slug must be a string' }, { status: 400 });
  }

  const result = await getPlayerRoundTraces(playerId, matchIds, slug ?? null);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, max-age=60' } });
}
