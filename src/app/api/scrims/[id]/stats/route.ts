import { NextResponse } from 'next/server';
import { getScrimNightById, getScrimNightStatsView } from '@/lib/queries';
import { parseRouteId } from '@/lib/util';

/**
 * A scrim night's Stats/Advanced Stats tab data (sabremetrics, rounds, kills, weapon-class and
 * economy breakdowns over its scored matches) — fetched lazily, client-side, the first time one of
 * those tabs is opened, as a season's is (`GET /api/seasons/[id]/stats`). Public, same as the night
 * page itself.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const nightId = parseRouteId((await params).id);
  if (nightId === null) return NextResponse.json({ error: 'Invalid night ID' }, { status: 400 });
  if (!(await getScrimNightById(nightId))) return NextResponse.json({ error: 'Night not found' }, { status: 404 });
  return NextResponse.json(await getScrimNightStatsView(nightId));
}
