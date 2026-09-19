import { NextRequest, NextResponse } from 'next/server';
import { getRegularSeasonLightView, getGauntletSeasonLightView, getPlayersById } from '@/lib/queries';
import { parseSeasonKind } from '../season-kind';

/**
 * The season detail page's per-tab "light" data — the Leaderboard/H2H/Groups/Schedule sub-tabs'
 * fields, needed regardless of which sub-tab is showing. The Regular Season and Gauntlet top tabs
 * share one page/URL (`CombinedSeasonTabView`), but only the initially-active tab's light data is
 * fetched server-side on page load; switching to the other tab fetches it here, once — the client
 * caches the result for the rest of the session, so switching back and forth afterward costs
 * nothing further. The Stats/Advanced Stats sub-tabs' own (heavier) fields are a separate lazy
 * fetch — see `GET /api/seasons/[id]/stats`. Public, same as the page itself — season stats aren't
 * gated behind a session.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const parsedKind = parseSeasonKind(req.nextUrl.searchParams.get('kind'));
  if ('error' in parsedKind) return parsedKind.error;
  const { kind } = parsedKind;

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
      ? await getRegularSeasonLightView(seasonId, seasonNumber, playersById)
      : await getGauntletSeasonLightView(seasonId, seasonNumber, playersById);

  return NextResponse.json(data);
}
