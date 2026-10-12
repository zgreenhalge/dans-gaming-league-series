import { getSeason, getSeasonScope, getPodSeasonId, getGauntletStageData } from '@/lib/queries';
import { deriveGroupPageView } from '@/lib/stage-views';
import { parseRouteId, seasonTitle } from '@/lib/util';
import { OG_SIZE } from '@/lib/seo/og-card';
import { renderStageOg, STATUS_LABEL } from '@/lib/seo/stage-og';

export const alt = 'DGLS Gauntlet Group';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const revalidate = 60;

export default async function Image({ params }: { params: Promise<{ id: string; podId: string }> }) {
  const { podId: podIdParam } = await params;
  const podId = parseRouteId(podIdParam);
  const seasonId = podId === null ? null : await getPodSeasonId(podId);
  const season = seasonId === null ? null : await getSeason(seasonId);
  const scope = season ? await getSeasonScope(season) : null;
  const view = season && scope && podId !== null ? deriveGroupPageView(scope.hub.id, await getGauntletStageData(season.id), podId) : null;

  return renderStageOg(
    view && scope
      ? {
          title: `${seasonTitle(scope.hub.name)} Gauntlet · Round ${view.roundNumber}${view.group.label ? ` · ${view.group.label}` : ''}`,
          status: STATUS_LABEL[view.group.status],
          matchups: view.group.matches.map((m) => ({
            shirts: m.shirts_stats.map((p) => p.player_name).join(' & ') || 'TBD',
            skins: m.skins_stats.map((p) => p.player_name).join(' & ') || 'TBD',
            finalScore: m.final_score,
          })),
          standings: view.group.scorecard.map((r) => ({
            name: r.player_name,
            record: r.matches_played > 0 ? `${r.wins}-${r.losses}` : r.seed != null ? `Seed ${r.seed}` : '',
          })),
        }
      : null,
    'Group not found',
  );
}
