import { notFound } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { SurveyAdminPanel } from '@/components/SurveyAdminPanel';
import { SuperlativesAdminPanel } from '@/components/SuperlativesAdminPanel';
import { getSeason, getSurveyResults, getSuperlativeResults, isSurveyOpen } from '@/lib/queries';
import { seasonTitle } from '@/lib/util';

export const metadata = {
  title: 'Season Feedback',
  description: 'Post-season survey and superlatives vote for a regular season.',
};

// Live results — don't cache. The admin gate lives in this route group's layout.tsx.
export const dynamic = 'force-dynamic';

export default async function SeasonFeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const seasonId = Number((await params).id);
  if (!Number.isFinite(seasonId)) notFound();

  const [season, survey, poll] = await Promise.all([
    getSeason(seasonId),
    getSurveyResults(seasonId),
    getSuperlativeResults(seasonId),
  ]);
  if (!season || season.is_gauntlet) notFound();

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
          <SurveyAdminPanel
            seasonId={seasonId}
            survey={
              survey && {
                isOpen: isSurveyOpen(survey.survey),
                responseCount: survey.responseCount,
                eligibleCount: survey.eligibleCount,
                summaries: survey.summaries,
              }
            }
          />
          <SuperlativesAdminPanel seasonId={seasonId} poll={poll} />
        </div>
      </main>
    </div>
  );
}
