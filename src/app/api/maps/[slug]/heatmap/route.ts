import { NextRequest, NextResponse } from 'next/server';
import { getMapHeatmapPoints, getPlayersById } from '@/lib/queries';

// Aggregates the per-match heatmap artifacts for a map's matches. POSTed (not GET) so
// the caller can hand us the match-id set it already has, avoiding a second heavy map
// query — the map page knows every match id and passes them straight through. This runs
// only when the Heatmap tab opens.
//
// Precomputed rollup first (issue #127): `getMapHeatmapPoints()` reads the map's
// merged rollup and falls back to a direct per-match fetch only for whatever match
// ids it doesn't (yet) cover, so the route itself does no merging.

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let matchIds: unknown;
  try {
    ({ matchIds } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(matchIds) || !matchIds.every((id) => typeof id === 'number')) {
    return NextResponse.json({ error: 'matchIds must be a number[]' }, { status: 400 });
  }

  // Independent reads — run together rather than serially.
  const [points, playersById] = await Promise.all([
    getMapHeatmapPoints(slug, matchIds),
    // Defensive: a Supabase hiccup here shouldn't take down the whole heatmap response,
    // just fall back to `#id` labels.
    getPlayersById().catch(() => new Map()),
  ]);

  // Resolve names only for players who actually appear in the points, so the
  // per-player filter's dropdown doesn't need a second roster fetch.
  const presentIds = new Set(points.map((p) => p.playerId).filter((id): id is number => id !== null));
  const players = [...presentIds]
    .map((id) => ({ id, name: playersById.get(id)?.name ?? `#${id}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ points, players }, { headers: { 'Cache-Control': 'private, max-age=60' } });
}
