import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import type { Metadata } from 'next';
import { TopbarShell } from '@/components/TopbarShell';
import { StageHeader } from '@/components/StageHeader';
import { StageNavStrip } from '@/components/StageNavStrip';
import { GroupPanel } from '@/components/GroupPanel';
import { getSeedNames, resolveGroupPage } from '@/lib/queries';
import { authOptions } from '@/lib/authOptions';
import { buildCrumbs, groupHref, regularSeasonLink, stageHeading } from '@/lib/crumbs';
import { describeMatchups, groupTitle } from '@/lib/seo/stage-meta';
import { parseRouteId, podKindLabel } from '@/lib/util';

type Params = { id: string; podId: string };

/** Resolves the URL to its gauntlet group (see the week page's loader for the redirect reasoning). */
const loadGroup = cache(async (idParam: string, podIdParam: string) => {
  const seasonId = parseRouteId(idParam);
  const podId = parseRouteId(podIdParam);
  if (seasonId === null || podId === null) notFound();
  const found = await resolveGroupPage(podId);
  if (!found) notFound();
  if (found.scope.hub.id !== seasonId) redirect(groupHref(found.scope.hub.id, podId));
  const seedNames = found.view.group.matches.length === 0 ? await getSeedNames(found.scope.hub.id) : undefined;
  return { hub: found.scope.hub, data: found.data, view: found.view, seedNames };
});

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id, podId } = await params;
  const { hub, view } = await loadGroup(id, podId);
  const title = groupTitle(hub.name, view.roundNumber, view.group.label);
  const matchups = describeMatchups(view.group.matches);
  const description = matchups ? `${title} — ${matchups}` : `${title} — lineup and results in DGLS.`;
  return {
    title,
    description,
    alternates: { canonical: groupHref(hub.id, view.group.pod.id) },
    openGraph: { title: `DGLS · ${title}`, description },
    twitter: { card: 'summary_large_image', title: `DGLS · ${title}`, description },
  };
}

export default async function GroupPage({ params }: { params: Promise<Params> }) {
  const { id, podId } = await params;
  const [{ hub, data, view, seedNames }, session] = await Promise.all([loadGroup(id, podId), getServerSession(authOptions)]);
  const currentPlayerId = session?.user?.playerId ?? null;
  const { group } = view;
  const { pod } = group;

  const trail = {
    season: hub,
    gauntlet: true,
    round: view.roundNumber,
    group: { id: pod.id, podIndex: pod.pod_index, isFinal: pod.is_final },
  };

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={buildCrumbs(trail)} />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <StageHeader
          heading={stageHeading(trail)}
          status={group.status}
          details={[podKindLabel(group.isFinal, group.advanceRule), group.matches.length === 0 && 'Not yet scheduled']}
        />
        <div className="mb-6">
          <StageNavStrip items={view.nav} label="Groups" meta={regularSeasonLink(hub)} />
        </div>
        <GroupPanel
          group={group}
          hubSeasonId={hub.id}
          bracketShape={data.bracketShape}
          seedNames={seedNames}
          currentPlayerId={currentPlayerId}
          standalone
        />
      </main>
    </div>
  );
}
