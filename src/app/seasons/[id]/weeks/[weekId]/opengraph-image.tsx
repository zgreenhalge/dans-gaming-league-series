import { resolveWeekPage } from '@/lib/queries';
import { parseRouteId } from '@/lib/util';
import { OG_SIZE } from '@/lib/seo/og-card';
import { weekTitle } from '@/lib/seo/stage-meta';
import { renderStageOg } from '@/lib/seo/stage-og';

export const alt = 'DGLS Week';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const revalidate = 60;

export default async function Image({ params }: { params: Promise<{ id: string; weekId: string }> }) {
  const { weekId: weekIdParam } = await params;
  const weekId = parseRouteId(weekIdParam);
  const found = weekId === null ? null : await resolveWeekPage(weekId);
  const view = found?.view;

  return renderStageOg(
    found && view
      ? {
          title: weekTitle(found.owner.name, view.week.week_number),
          status: view.status,
          matches: view.week.matches,
          standings: view.scorecard.map((r) => ({ name: r.player_name, record: `${r.wins}-${r.losses}` })),
        }
      : null,
    'Week not found',
  );
}
