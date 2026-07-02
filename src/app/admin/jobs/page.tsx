import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { getBackgroundJobs, isPlayerAdmin } from '@/lib/queries';
import { groupBackgroundJobs } from '@/lib/jobs';
import { JobsDashboard } from '@/components/JobsDashboard';

export const metadata = {
  title: 'Background Jobs',
  description: 'Admin view of every DGLS background-job pipeline (demo ingest, replay, radar).',
};

// Don't cache — this is a live operational dashboard.
export const dynamic = 'force-dynamic';

/**
 * Admin background-jobs dashboard (issue #145). Generalizes the demo-ingestion dashboard (#141) into
 * one surface over all three `background_jobs` pipelines — `demo_ingest`, `replay_extract`,
 * `radar_build` — so nothing fails silently anywhere. This server component only gates access, fetches
 * (`getBackgroundJobs`), and groups by subject (`groupBackgroundJobs`); the interactive tabs, type
 * filters, and per-lane actions live in the client `JobsDashboard`.
 */
export default async function BackgroundJobsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) redirect('/');
  if (!(await isPlayerAdmin(session.user.playerId))) redirect('/');

  const groups = groupBackgroundJobs(await getBackgroundJobs());

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Background Jobs' }]} />
      <main className="max-w-[760px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[28px] font-semibold leading-tight">Background Jobs</div>
        </div>

        <JobsDashboard groups={groups} />
      </main>
    </div>
  );
}
