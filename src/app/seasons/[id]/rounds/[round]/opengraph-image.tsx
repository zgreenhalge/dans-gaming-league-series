import { getSeason, getSeasonScope, getGauntletStageData } from '@/lib/queries';
import { deriveRoundView } from '@/lib/stage-views';
import { parseRouteId, seasonTitle } from '@/lib/util';
import { OG_SIZE } from '@/lib/seo/og-card';
import { renderStageOg, STATUS_LABEL } from '@/lib/seo/stage-og';

export const alt = 'DGLS Gauntlet Round';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const revalidate = 60;

export default async function Image({ params }: { params: Promise<{ id: string; round: string }> }) {
  const { id, round } = await params;
  const seasonId = parseRouteId(id);
  const roundNumber = parseRouteId(round);
  const season = seasonId === null ? null : await getSeason(seasonId);
  const scope = season ? await getSeasonScope(season) : null;
  const view =
    scope?.gauntlet && roundNumber !== null
      ? deriveRoundView(scope.hub.id, await getGauntletStageData(scope.gauntlet.id), roundNumber)
      : null;

  return renderStageOg(
    view && scope
      ? {
          title: `${seasonTitle(scope.hub.name)} Gauntlet · Round ${view.roundNumber}`,
          status: STATUS_LABEL[view.status],
          matchups: view.groups.flatMap((g) =>
            g.matches.map((m) => ({
              shirts: m.shirts_stats.map((p) => p.player_name).join(' & ') || 'TBD',
              skins: m.skins_stats.map((p) => p.player_name).join(' & ') || 'TBD',
              finalScore: m.final_score,
            })),
          ),
          standings: [],
        }
      : null,
    'Round not found',
  );
}
