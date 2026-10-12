import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import type { Metadata } from 'next';
import { TopbarShell } from '@/components/TopbarShell';
import { StageHeader } from '@/components/StageHeader';
import { StageNavStrip } from '@/components/StageNavStrip';
import { GroupPanel } from '@/components/GroupPanel';
import { getSeason, getSeasonScope, getPodSeasonId, getGauntletStageData } from '@/lib/queries';
import { authOptions } from '@/lib/authOptions';
import { buildCrumbs, gauntletHref, groupHref, roundHref } from '@/lib/crumbs';
import { deriveGroupPageView } from '@/lib/stage-views';
import { describeMatchups } from '@/lib/seo/stage-meta';
import { parseRouteId, seasonTitle } from '@/lib/util';

export const revalidate = 60;

type Params = { id: string; podId: string };

/** Resolves the URL to its gauntlet group (see the week page's loader for the redirect reasoning). */
const loadGroup = cache(async (idParam: string, podIdParam: string) => {
  const seasonId = parseRouteId(idParam);
  const podId = parseRouteId(podIdParam);
  if (seasonId === null || podId === null) notFound();
  const podSeasonId = await getPodSeasonId(podId);
  if (podSeasonId === null) notFound();
  const owner = await getSeason(podSeasonId);
  if (!owner) notFound();
  const scope = await getSeasonScope(owner);
  if (scope.hub.id !== seasonId) redirect(groupHref(scope.hub.id, podId));
  const data = await getGauntletStageData(owner.id);
  const view = deriveGroupPageView(scope.hub.id, data, podId);
  if (!view) notFound();
  return { hub: scope.hub, data, view };
});

function titleOf(hubName: string, roundNumber: number, label: string | null): string {
  return `${seasonTitle(hubName)} Gauntlet · Round ${roundNumber}${label ? ` · ${label}` : ''}`;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id, podId } = await params;
  const { hub, view } = await loadGroup(id, podId);
  const title = titleOf(hub.name, view.roundNumber, view.group.label);
  const matchups = describeMatchups(view.group.matches);
  const description = matchups ? `${title} — ${matchups}` : `${title} — lineup and results in DGLS.`;
  return {
    title,
    description,
    alternates: { canonical: groupHref(hub.id, view.group.pod?.id ?? 0) },
    openGraph: { title: `DGLS · ${title}`, description },
    twitter: { card: 'summary_large_image', title: `DGLS · ${title}`, description },
  };
}

export default async function GroupPage({ params }: { params: Promise<Params> }) {
  const { id, podId } = await params;
  const [{ hub, data, view }, session] = await Promise.all([loadGroup(id, podId), getServerSession(authOptions)]);
  const currentPlayerId = session?.user?.playerId ?? null;
  const { group } = view;
  const pod = group.pod!;

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={buildCrumbs({
          season: hub,
          gauntlet: true,
          week: { id: view.weekId, number: view.roundNumber },
          group: { id: pod.id, podIndex: pod.pod_index, isFinal: pod.is_final },
        })}
      />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <StageHeader
          title={titleOf(hub.name, view.roundNumber, group.label)}
          status={group.status}
          upHref={view.weekId != null ? roundHref(hub.id, view.weekId) : gauntletHref(hub.id)}
          upLabel={`Round ${view.roundNumber}`}
          details={
            <>
              <span>{group.isFinal ? 'Final' : group.advanceRule === 'wildcard' ? 'Wildcard' : 'Elimination'}</span>
              <span>{group.matches.length > 0 ? `${group.matches.length} ${group.matches.length === 1 ? 'game' : 'games'}` : 'Not yet scheduled'}</span>
            </>
          }
        />
        <div className="mb-6">
          <StageNavStrip nav={view.nav} prev={view.prev} next={view.next} noun="Groups" />
        </div>
        <GroupPanel
          group={group}
          hubSeasonId={hub.id}
          bracketShape={data.bracketShape}
          currentPlayerId={currentPlayerId}
          standalone
        />
      </main>
    </div>
  );
}
