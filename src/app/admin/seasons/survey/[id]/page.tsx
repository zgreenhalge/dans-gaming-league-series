import { TopbarShell } from '@/components/TopbarShell';
import { SurveyAdminPanel } from '@/components/SurveyAdminPanel';
import { getSurveyResults } from '@/lib/queries';
import { resolveFeedbackAdminSeason } from '@/lib/feedback-page';
import { seasonTitle } from '@/lib/util';

export const metadata = {
  title: 'Season Survey',
  description: 'Send a regular season’s post-season survey and read its anonymised results.',
};

// Live results — don't cache. The admin gate lives in this route group's layout.tsx.
export const dynamic = 'force-dynamic';

export default async function SeasonSurveyAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const season = await resolveFeedbackAdminSeason((await params).id, '/admin/seasons/survey');
  const survey = await getSurveyResults(season.id);

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Admin', href: '/admin' },
          { label: seasonTitle(season.name), href: `/seasons/${season.id}` },
          { label: 'Survey' },
        ]}
      />
      <main className="max-w-[900px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-8 font-display text-[28px] font-semibold leading-tight">
          {seasonTitle(season.name)} Survey
        </div>
        <SurveyAdminPanel seasonId={season.id} survey={survey} />
      </main>
    </div>
  );
}
