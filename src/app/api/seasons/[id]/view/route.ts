import { NextRequest, NextResponse } from 'next/server';
import { getRegularSeasonHeavyView, getGauntletSeasonHeavyView, getPlayersById } from '@/lib/queries';

/**
 * The season detail page's per-match ("heavy") tab data. The Regular Season and Gauntlet tabs share
 * one page/URL (`CombinedSeasonTabView`), but only the initially-active tab's heavy data is fetched
 * server-side on page load; switching to the other tab fetches it here, once — the client caches the
 * result for the rest of the session, so switching back and forth afterward costs nothing further.
 * Public, same as the page itself — season stats aren't gated behind a session.
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

  let seasonNumber: number | null = null;
  const seasonNumberRaw = req.nextUrl.searchParams.get('seasonNumber');
  if (seasonNumberRaw != null && seasonNumberRaw !== '') {
    const parsed = Number(seasonNumberRaw);
    if (!Number.isFinite(parsed)) {
      return NextResponse.json({ error: 'Invalid seasonNumber' }, { status: 400 });
    }
    seasonNumber = parsed;
  }

  const playersById = await getPlayersById();
  const data =
    kind === 'regular'
      ? await getRegularSeasonHeavyView(seasonId, seasonNumber, playersById)
      : await getGauntletSeasonHeavyView(seasonId, seasonNumber, playersById);

  return NextResponse.json(data);
}
