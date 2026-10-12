import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import type { Metadata } from 'next';
import { TopbarShell } from '@/components/TopbarShell';
import { StageHeader } from '@/components/StageHeader';
import { StageNavStrip } from '@/components/StageNavStrip';
import { GroupPanel } from '@/components/GroupPanel';
import EmptyState from '@/components/EmptyState';
import { getSeason, getSeasonScope, getWeekRow, getGauntletStageData } from '@/lib/queries';
import { authOptions } from '@/lib/authOptions';
import { buildCrumbs, gauntletHref, roundHref, weekHref } from '@/lib/crumbs';
import { deriveRoundView } from '@/lib/stage-views';
import { describeMatchups } from '@/lib/seo/stage-meta';
import { parseRouteId, seasonTitle } from '@/lib/util';

export const revalidate = 60;

type Params = { id: string; weekId: string };

/** Resolves the URL to its gauntlet round (see the week page's loader for the redirect reasoning). */
const loadRound = cache(async (idParam: string, weekIdParam: string) => {
  const seasonId = parseRouteId(idParam);
  const weekId = parseRouteId(weekIdParam);
  if (seasonId === null || weekId === null) notFound();
  const row = await getWeekRow(weekId);
  if (!row) notFound();
  const owner = await getSeason(row.season_id);
  if (!owner) notFound();
  const scope = await getSeasonScope(owner);
  if (!owner.is_gauntlet) redirect(weekHref(scope.hub.id, weekId));
  if (scope.hub.id !== seasonId) redirect(roundHref(scope.hub.id, weekId));
  const data = await getGauntletStageData(owner.id);
  const view = deriveRoundView(scope.hub.id, data, weekId);
  if (!view) notFound();
  return { hub: scope.hub, data, view };
});

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id, weekId } = await params;
  const { hub, view } = await loadRound(id, weekId);
  const title = `${seasonTitle(hub.name)} Gauntlet · Round ${view.roundNumber}`;
  const matchups = describeMatchups(view.groups.flatMap((g) => g.matches));
  const description = matchups ? `${title} — ${matchups}` : `${title} — groups and results in DGLS.`;
  return {
    title,
    description,
    alternates: { canonical: roundHref(hub.id, view.weekId ?? 0) },
    openGraph: { title: `DGLS · ${title}`, description },
    twitter: { card: 'summary_large_image', title: `DGLS · ${title}`, description },
  };
}

export default async function RoundPage({ params }: { params: Promise<Params> }) {
  const { id, weekId } = await params;
  const [{ hub, data, view }, session] = await Promise.all([loadRound(id, weekId), getServerSession(authOptions)]);
  const currentPlayerId = session?.user?.playerId ?? null;

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={buildCrumbs({ season: hub, gauntlet: true, week: { id: view.weekId, number: view.roundNumber } })} />
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
