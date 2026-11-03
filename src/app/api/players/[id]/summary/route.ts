import { NextResponse } from 'next/server';
import { getPlayerSummary } from '@/lib/queries';
import { parseRouteId } from '@/lib/util';

// A player's career snapshot (`PlayerSummary`) for the player hover card (`PlayerLink.tsx`), which
// fetches it the first time a player's name is hovered. Public, like the player page it previews.

// The response is identical for every viewer, so the CDN may serve repeat hovers: fresh for a
// minute, then stale for up to five more while it revalidates in the background.
const SUMMARY_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const playerId = parseRouteId(id);
  if (playerId === null) {
    return NextResponse.json({ error: 'Invalid player ID' }, { status: 400 });
  }
  const summary = await getPlayerSummary(playerId);
  if (!summary) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  }
  return NextResponse.json(summary, { headers: { 'Cache-Control': SUMMARY_CACHE_CONTROL } });
}
