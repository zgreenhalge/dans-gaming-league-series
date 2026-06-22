import { NextRequest, NextResponse } from 'next/server';
import { getMapCalibration } from '@/lib/queries';
import { getR2Object, radarKey } from '@/lib/r2';

// Streams a map's extracted top-down radar PNG from R2 (Phase 3). The radar lives at
// the deterministic `radarKey(mapId)`; calibration gates access so we never 404 a
// half-configured map differently from an uncalibrated one. Read-only and public,
// consistent with the rest of the maps pages.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const cal = await getMapCalibration(slug);
  if (!cal) {
    return NextResponse.json({ error: 'No radar for this map' }, { status: 404 });
  }
  const buf = await getR2Object(radarKey(cal.mapId));
  if (!buf) {
    return NextResponse.json({ error: 'Radar image missing' }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      // Radar PNGs are stable per map; cache hard (re-running radar-build overwrites
      // the same key, so bump via a deploy or the calibration source if needed).
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
