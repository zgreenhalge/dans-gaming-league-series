import { NextRequest, NextResponse } from 'next/server';
import { getMapCalibration } from '@/lib/queries';

// Returns a map's radar calibration triplet (Phase 3), or `{ calibration: null }`
// when uncalibrated. The replay player / heatmap fetch this to decide between the
// real radar background (calibrated) and the auto-fit grid. The radar image itself is
// served by the sibling `…/radar` route; image pixel dimensions are read client-side
// off the loaded image, so they aren't stored. See `docs/replay.md`.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const cal = await getMapCalibration(slug);
  if (!cal) return NextResponse.json({ calibration: null });
  return NextResponse.json(
    {
      calibration: { posX: cal.posX, posY: cal.posY, scale: cal.scale },
      radarUrl: `/api/maps/${slug}/radar`,
    },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}
