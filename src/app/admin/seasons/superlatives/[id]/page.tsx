import { TopbarShell } from '@/components/TopbarShell';
import { SuperlativesAdminPanel } from '@/components/SuperlativesAdminPanel';
import { getSuperlativeResults } from '@/lib/queries';
import { resolveFeedbackAdminSeason } from '@/lib/feedback-page';
import { seasonTitle } from '@/lib/util';

export const metadata = {
  title: 'Season Superlatives',
  description: 'Choose a regular season’s superlatives, open voting, and see the tallies.',
};

// Live results — don't cache. The admin gate lives in this route group's layout.tsx.
export const dynamic = 'force-dynamic';

export default async function SeasonSuperlativesAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const season = await resolveFeedbackAdminSeason((await params).id, '/admin/seasons/superlatives');
  const poll = await getSuperlativeResults(season.id);

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Admin', href: '/admin' },
          { label: seasonTitle(season.name), href: `/seasons/${season.id}` },
          { label: 'Superlatives' },
        ]}
      />
      <main className="max-w-[900px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-8 font-display text-[28px] font-semibold leading-tight">
          {seasonTitle(season.name)} Superlatives
        </div>
        <SuperlativesAdminPanel seasonId={season.id} poll={poll} />
      </main>
    </div>
  );
}
