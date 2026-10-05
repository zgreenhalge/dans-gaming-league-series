// Shared lookup for the admin survey and superlatives pages: resolves the page's `[id]` segment to
// its regular season. A gauntlet shares its regular season's survey and superlatives, so a gauntlet
// id redirects to the paired regular season's page (`basePath` + its id); anything else that isn't a
// regular season is a 404. Calls Next's `notFound()`/`redirect()`, which throw — it only returns a
// season.

import { notFound, redirect } from 'next/navigation';
import { getLinkedRegularSeason, getSeason } from './queries';
import { parseSeasonId } from './util';
import type { Season } from './types';

export async function resolveFeedbackAdminSeason(rawId: string, basePath: string): Promise<Season> {
  const seasonId = parseSeasonId(rawId);
  if (seasonId == null) notFound();

  const season = await getSeason(seasonId);
  if (!season) notFound();
  if (season.is_gauntlet) {
    const linked = await getLinkedRegularSeason(season.name);
    if (linked) redirect(`${basePath}/${linked.id}`);
    notFound();
  }
  return season;
}
