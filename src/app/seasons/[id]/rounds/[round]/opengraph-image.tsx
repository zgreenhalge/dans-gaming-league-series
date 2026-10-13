import { resolveRoundPage } from '@/lib/queries';
import { parseRouteId } from '@/lib/util';
import { OG_SIZE } from '@/lib/seo/og-card';
import { roundTitle } from '@/lib/seo/stage-meta';
import { renderStageOg } from '@/lib/seo/stage-og';

export const alt = 'DGLS Gauntlet Round';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const revalidate = 60;

export default async function Image({ params }: { params: Promise<{ id: string; round: string }> }) {
  const { id, round } = await params;
  const seasonId = parseRouteId(id);
  const roundNumber = parseRouteId(round);
  const found = seasonId === null || roundNumber === null ? null : await resolveRoundPage(seasonId, roundNumber);

  return renderStageOg(
    found
      ? {
          title: roundTitle(found.scope.hub.name, found.view.roundNumber),
          status: found.view.status,
          matches: found.view.groups.flatMap((g) => g.matches),
          standings: [],
        }
      : null,
    'Round not found',
  );
}
