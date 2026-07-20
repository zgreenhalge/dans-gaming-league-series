import { NextRequest, NextResponse } from 'next/server';
import { getMapHeatmap, getMapHeatmapRollup, getPlayersById, type MapHeatmapPoint } from '@/lib/queries';

// Aggregates the per-match heatmap artifacts for a map's matches. POSTed (not GET) so
// the caller can hand us the match-id set it already has, avoiding a second heavy map
// query — the map page knows every match id and passes them straight through. This runs
// only when the Heatmap tab opens.
//
// Precomputed rollup first (issue #127): the `replay-extract` Action maintains a merged
// `maps/<slug>/heatmap.json` covering every match it knows about for the map, rebuilt
// whenever any one of those matches is (re-)extracted. Any requested match id the
// rollup doesn't (yet) cover — a brand-new map before its first post-rollout Action
// run, or the rare race with a `replay-extract-all` backfill — falls back to the
// original per-match fan-out (`getMapHeatmap`) for just that delta, so the response is
// always correct and usually a single R2 read instead of one per match.

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

  const [rollup, playersById] = await Promise.all([
    getMapHeatmapRollup(slug),
    // Defensive: a Supabase hiccup here shouldn't take down the whole heatmap response,
    // just fall back to `#id` labels (getMapHeatmap already has its own fail-soft path).
    getPlayersById().catch(() => new Map()),
  ]);

  const covered = new Set(rollup?.matchIds ?? []);
  const requested = new Set(matchIds);
  const missing = matchIds.filter((id) => !covered.has(id));

  const fromRollup = (rollup?.points ?? []).filter((p) => requested.has(p.matchId));
  const fromFallback: MapHeatmapPoint[] = missing.length > 0 ? await getMapHeatmap(missing) : [];
  const points = [...fromRollup, ...fromFallback];

  // Resolve names only for players who actually appear in the points, so the
  // per-player filter's dropdown doesn't need a second roster fetch.
  const presentIds = new Set(points.map((p) => p.playerId).filter((id): id is number => id !== null));
  const players = [...presentIds]
    .map((id) => ({ id, name: playersById.get(id)?.name ?? `#${id}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ points, players }, { headers: { 'Cache-Control': 'private, max-age=60' } });
}
