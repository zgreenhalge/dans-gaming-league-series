import type { Metadata } from 'next';
import { TopbarShell } from '@/components/TopbarShell';
import { ScheduleLabView } from '@/components/ScheduleLabView';
import { getScheduleLabData } from '@/lib/queries';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Schedule Lab',
  description: 'Generate and compare regular-season schedule formats for any DGLS roster.',
  robots: { index: false },
};

// Read-only: plans are generated in the browser from this data and never saved.
export default async function ScheduleLabPage() {
  const data = await getScheduleLabData();
  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Schedule Lab' }]} />
      <main className="max-w-[1100px] mx-auto px-4 sm:px-6 pb-16">
        <h1 className="mt-8 mb-6 font-display text-[28px] font-semibold leading-tight">Schedule Lab</h1>
        <ScheduleLabView players={data.players} rosters={data.rosters} />
      </main>
    </div>
  );
}
