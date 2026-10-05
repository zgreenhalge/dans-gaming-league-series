import { notFound, redirect } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { SurveyAdminPanel } from '@/components/SurveyAdminPanel';
import { SuperlativesAdminPanel } from '@/components/SuperlativesAdminPanel';
import { getSeason, getLinkedRegularSeason, getSurveyResults, getSuperlativeResults } from '@/lib/queries';
import { parseSeasonId, seasonTitle } from '@/lib/util';

export const metadata = {
  title: 'Season Feedback',
  description: 'Post-season survey and superlatives vote for a regular season.',
};

// Live results — don't cache. The admin gate lives in this route group's layout.tsx.
export const dynamic = 'force-dynamic';

export default async function SeasonFeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const seasonId = parseSeasonId((await params).id);
  if (seasonId == null) notFound();

  const season = await getSeason(seasonId);
  if (!season) notFound();
  // A gauntlet shares its regular season's survey and superlatives — send its id to the paired one.
  if (season.is_gauntlet) {
    const linked = await getLinkedRegularSeason(season.name);
    if (linked) redirect(`/admin/seasons/feedback/${linked.id}`);
    notFound();
  }
  const [survey, poll] = await Promise.all([getSurveyResults(seasonId), getSuperlativeResults(seasonId)]);

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Admin', href: '/admin' },
          { label: seasonTitle(season.name), href: `/seasons/${seasonId}` },
          { label: 'Feedback' },
        ]}
      />
      <main className="max-w-[900px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-8 font-display text-[28px] font-semibold leading-tight">
          {seasonTitle(season.name)} Feedback
        </div>
        <div className="flex flex-col gap-12">
          <SurveyAdminPanel seasonId={seasonId} survey={survey} />
          <SuperlativesAdminPanel seasonId={seasonId} poll={poll} />
        </div>
      </main>
    </div>
  );
}
