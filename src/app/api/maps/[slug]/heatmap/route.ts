import { NextRequest, NextResponse } from 'next/server';
import { getMapHeatmap } from '@/lib/queries';

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
  const points = await getMapHeatmap(matchIds);
  return NextResponse.json({ points }, { headers: { 'Cache-Control': 'private, max-age=60' } });
}
