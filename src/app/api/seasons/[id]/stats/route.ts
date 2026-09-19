import { NextRequest, NextResponse } from 'next/server';
import { getRegularSeasonStatsView, getGauntletSeasonStatsView } from '@/lib/queries';

/**
 * The season detail page's Stats/Advanced Stats sub-tab data (sabremetrics, per-match rounds,
 * kills, weapon-class and economy breakdowns) — the most expensive queries this app runs, so
 * they're fetched here, lazily and client-side, only the first time one of those two sub-tabs is
 * actually opened, rather than on every page load regardless of which sub-tab (if any) the visitor
 * ever looks at. See `SeasonTabView`'s own fetch effect, and `GET /api/seasons/[id]/view` for the
 * lighter data every sub-tab needs. Public, same as the page itself — season stats aren't gated
 * behind a session.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const kind = req.nextUrl.searchParams.get('kind');
  if (kind !== 'regular' && kind !== 'gauntlet') {
    return NextResponse.json({ error: "kind must be 'regular' or 'gauntlet'" }, { status: 400 });
  }

  const data = kind === 'regular' ? await getRegularSeasonStatsView(seasonId) : await getGauntletSeasonStatsView(seasonId);

  return NextResponse.json(data);
}
