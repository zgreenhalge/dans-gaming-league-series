import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import type { Metadata } from 'next';
import { TopbarShell } from '@/components/TopbarShell';
import { StageHeader } from '@/components/StageHeader';
import { StageNavStrip } from '@/components/StageNavStrip';
import { GroupPanel } from '@/components/GroupPanel';
import EmptyState from '@/components/EmptyState';
import { getSeason, getSeasonScope, getGauntletStageData, getSeedNames } from '@/lib/queries';
import { authOptions } from '@/lib/authOptions';
import { buildCrumbs, gauntletHref, roundHref } from '@/lib/crumbs';
import { deriveRoundView } from '@/lib/stage-views';
import { describeMatchups } from '@/lib/seo/stage-meta';
import { parseRouteId, seasonTitle } from '@/lib/util';

export const revalidate = 60;

type Params = { id: string; round: string };

/** Resolves the URL to its gauntlet round. A round is identified by its number within the gauntlet,
 *  so it has a page as soon as the bracket does — scheduled or not. A gauntlet's or an unrelated
 *  season's id in the path redirects to the round's real hub. */
const loadRound = cache(async (idParam: string, roundParam: string) => {
  const seasonId = parseRouteId(idParam);
  const roundNumber = parseRouteId(roundParam);
  if (seasonId === null || roundNumber === null) notFound();
  const season = await getSeason(seasonId);
  if (!season) notFound();
  const scope = await getSeasonScope(season);
  if (!scope.gauntlet) notFound();
  if (scope.hub.id !== seasonId) redirect(roundHref(scope.hub.id, roundNumber));
  const data = await getGauntletStageData(scope.gauntlet.id);
  const view = deriveRoundView(scope.hub.id, data, roundNumber);
  if (!view) notFound();
  const seedNames = view.groups.some((g) => g.matches.length === 0) ? await getSeedNames(scope.hub.id) : undefined;
  return { hub: scope.hub, data, view, seedNames };
});

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id, round } = await params;
  const { hub, view } = await loadRound(id, round);
  const title = `${seasonTitle(hub.name)} Gauntlet · Round ${view.roundNumber}`;
  const matchups = describeMatchups(view.groups.flatMap((g) => g.matches));
  const description = matchups ? `${title} — ${matchups}` : `${title} — groups and results in DGLS.`;
  return {
    title,
    description,
    alternates: { canonical: roundHref(hub.id, view.roundNumber) },
    openGraph: { title: `DGLS · ${title}`, description },
    twitter: { card: 'summary_large_image', title: `DGLS · ${title}`, description },
  };
}

export default async function RoundPage({ params }: { params: Promise<Params> }) {
  const { id, round } = await params;
  const [{ hub, data, view, seedNames }, session] = await Promise.all([loadRound(id, round), getServerSession(authOptions)]);
  const currentPlayerId = session?.user?.playerId ?? null;

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={buildCrumbs({ season: hub, gauntlet: true, round: view.roundNumber })} />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <StageHeader
          title={`${seasonTitle(hub.name)} Gauntlet · Round ${view.roundNumber}`}
          status={view.status}
          upHref={gauntletHref(hub.id)}
          upLabel="Gauntlet bracket"
          details={
            <>
              <span>
                {view.groups.length} {view.groups.length === 1 ? 'group' : 'groups'}
              </span>
              {view.isFinal && <span>Final round</span>}
            </>
          }
        />
        <div className="mb-6">
          <StageNavStrip nav={view.nav} noun="Rounds" />
        </div>
        {view.groups.length > 0 ? (
          view.groups.map((g, i) => (
            <GroupPanel
              key={g.pod?.id ?? `solo-${i}`}
              group={g}
              hubSeasonId={hub.id}
              bracketShape={data.bracketShape}
              seedNames={seedNames}
              currentPlayerId={currentPlayerId}
            />
          ))
        ) : (
          <EmptyState message="No groups in this round yet." size="lg" />
        )}
      </main>
    </div>
  );
}
