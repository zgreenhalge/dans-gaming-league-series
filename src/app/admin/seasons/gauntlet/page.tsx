import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { CreateGauntletForm } from '@/components/CreateGauntletForm';
import { getSeasons, isPlayerAdmin } from '@/lib/queries';
import { buildRegularToGauntletMap } from '@/lib/util';

export const metadata = {
  title: 'Start Gauntlet',
  description: 'Build a gauntlet bracket for an active DGLS season.',
};

export default async function GauntletSeasonPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) redirect('/');
  if (!(await isPlayerAdmin(session.user.playerId))) redirect('/');

  const seasons = await getSeasons();
  const regularSeasons = seasons.filter((s) => !s.is_gauntlet);
  const gauntletSeasons = seasons.filter((s) => s.is_gauntlet);
  const paired = buildRegularToGauntletMap(regularSeasons, gauntletSeasons);

  const eligible = regularSeasons
    .filter((s) => s.status === 'ACTIVE' && !paired.has(s.id))
    .map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Admin', href: '/admin' },
          { label: 'Start Gauntlet' },
        ]}
      />
      <main className="max-w-[640px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-8">
          <div className="font-display text-[28px] font-semibold leading-tight">Start Gauntlet</div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-2">
            Builds the single-elimination bracket from the season&apos;s current canonical-sort
            leaderboard and creates the paired gauntlet season immediately.
          </div>
        </div>
        <CreateGauntletForm seasons={eligible} />
      </main>
    </div>
  );
}
