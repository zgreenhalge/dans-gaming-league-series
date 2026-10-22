import { NextResponse } from 'next/server';
import { getPlayerSummary } from '@/lib/queries';
import { parseRouteId } from '@/lib/util';

// A player's career snapshot (`PlayerSummary`) for the player hover card (`PlayerLink.tsx`), which
// fetches it the first time a player's name is hovered. Public, like the player page it previews.

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
  return NextResponse.json(summary, { headers: { 'Cache-Control': 'private, max-age=60' } });
}
