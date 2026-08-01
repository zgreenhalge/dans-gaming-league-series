import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { getMapsForWorkshopPicker } from '@/lib/queries';
import { listConfigSets } from '@/lib/dathost-config';
import { getAdminClient } from '@/lib/supabase-admin';
import { ScrimPanel } from '@/components/ScrimPanel';

export const metadata = {
  title: 'Scrims',
  description: 'Start a casual game on the shared DGLS match server — free-form roster, no stats.',
};

// Live operational view — don't cache.
export const dynamic = 'force-dynamic';

export default async function ScrimPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) redirect('/');

  const [maps, configSets] = await Promise.all([getMapsForWorkshopPicker(), listConfigSets(getAdminClient())]);

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Scrims' }]} />
      <main className="max-w-[760px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-2">
          <div className="font-display text-[28px] font-semibold leading-tight">Scrims</div>
        </div>
        <div className="mt-6">
          <ScrimPanel configSets={configSets} maps={maps} />
        </div>
      </main>
    </div>
  );
}
