import { getSeason, getWeekRow, getWeekView } from '@/lib/queries';
import { parseRouteId, seasonTitle } from '@/lib/util';
import { OG_SIZE } from '@/lib/seo/og-card';
import { renderStageOg, STATUS_LABEL } from '@/lib/seo/stage-og';

export const alt = 'DGLS Week';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const revalidate = 60;

export default async function Image({ params }: { params: Promise<{ id: string; weekId: string }> }) {
  const { weekId: weekIdParam } = await params;
  const weekId = parseRouteId(weekIdParam);
  const row = weekId === null ? null : await getWeekRow(weekId);
  const season = row ? await getSeason(row.season_id) : null;
  const view = season && !season.is_gauntlet && weekId !== null ? await getWeekView(season.id, weekId) : null;

  return renderStageOg(
    view && season
      ? {
          title: `${seasonTitle(season.name)} · Week ${view.week.week_number}`,
          status: STATUS_LABEL[view.status],
          matchups: view.week.matches.map((m) => ({
            shirts: m.shirts_stats.map((p) => p.player_name).join(' & ') || 'TBD',
            skins: m.skins_stats.map((p) => p.player_name).join(' & ') || 'TBD',
            finalScore: m.final_score,
          })),
          standings: view.scorecard.map((r) => ({ name: r.player_name, record: `${r.wins}-${r.losses}` })),
        }
      : null,
    'Week not found',
  );
}
