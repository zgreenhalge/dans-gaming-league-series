// Resolves an admin survey/superlatives page's `[id]` to its regular season. A gauntlet id redirects
// to the paired regular season (`basePath` + its id); anything else that isn't one is a 404.

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
