import { NextRequest, NextResponse } from 'next/server';
import { getMapHeatmap, getPlayersById } from '@/lib/queries';

// Aggregates the per-match heatmap artifacts for a map's matches. POSTed (not GET) so
// the caller can hand us the match-id set it already has, avoiding a second heavy map
// query — the map page knows every match id and passes them straight through. This runs
// only when the Heatmap tab opens, so the per-match R2 fan-out is no longer paid on
// every map-page render. See `docs/replay.md` and issue #121 for a scalable rollup.

export async function POST(req: NextRequest) {
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
    getMapHeatmap(matchIds),
    // Defensive: a Supabase hiccup here shouldn't take down the whole heatmap response,
    // just fall back to `#id` labels (getMapHeatmap already has its own fail-soft path).
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
