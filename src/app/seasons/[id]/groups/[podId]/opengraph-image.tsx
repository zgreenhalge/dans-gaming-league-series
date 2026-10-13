import { resolveGroupPage } from '@/lib/queries';
import { parseRouteId } from '@/lib/util';
import { hasPlayed } from '@/lib/group-scorecard';
import { OG_SIZE } from '@/lib/seo/og-card';
import { groupTitle } from '@/lib/seo/stage-meta';
import { renderStageOg } from '@/lib/seo/stage-og';

export const alt = 'DGLS Gauntlet Group';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const revalidate = 60;

export default async function Image({ params }: { params: Promise<{ id: string; podId: string }> }) {
  const { podId: podIdParam } = await params;
  const podId = parseRouteId(podIdParam);
  const found = podId === null ? null : await resolveGroupPage(podId);
  const group = found?.view.group;

  return renderStageOg(
    found && group
      ? {
          title: groupTitle(found.scope.hub.name, found.view.roundNumber, group.label),
          status: group.status,
          matches: group.matches,
          standings: group.scorecard.map((r) => ({
            name: r.player_name,
            record: hasPlayed(r) ? `${r.wins}-${r.losses}` : r.seed != null ? `Seed ${r.seed}` : '',
          })),
        }
      : null,
    'Group not found',
  );
}
