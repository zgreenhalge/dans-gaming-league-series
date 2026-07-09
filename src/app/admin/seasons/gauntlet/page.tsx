import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { CreateGauntletForm } from '@/components/CreateGauntletForm';
import { ResetGauntletList } from '@/components/ResetGauntletList';
import { getSeasons, getGauntletRounds, isPlayerAdmin } from '@/lib/queries';
import { buildRegularToGauntletMap, isPlayedScore } from '@/lib/util';

export const metadata = {
  title: 'Start Gauntlet',
  description: 'Build or reset a gauntlet bracket for an active DGLS season.',
};

export default async function GauntletSeasonPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) redirect('/');
  if (!(await isPlayerAdmin(session.user.playerId))) redirect('/');

  const seasons = await getSeasons();
  const regularSeasons = seasons.filter((s) => !s.is_gauntlet);
  const gauntletSeasons = seasons.filter((s) => s.is_gauntlet);
  const paired = buildRegularToGauntletMap(regularSeasons, gauntletSeasons);
  const gauntletById = new Map(gauntletSeasons.map((g) => [g.id, g]));

  const activeRegular = regularSeasons.filter((s) => s.status === 'ACTIVE');

  const eligible = activeRegular
    .filter((s) => !paired.has(s.id))
    .map((s) => ({ id: s.id, name: s.name }));

  const withGauntlet = await Promise.all(
    activeRegular
      .filter((s) => paired.has(s.id))
      .map(async (s) => {
        const gauntletId = paired.get(s.id)!;
        const rounds = await getGauntletRounds(gauntletId);
        const started = rounds.some((r) => r.matches.some((m) => isPlayedScore(m.final_score)));
        return {
          regularSeasonId: s.id,
          regularSeasonName: s.name,
          gauntletName: gauntletById.get(gauntletId)?.name ?? `Season ${gauntletId} Gauntlet`,
          started,
        };
      }),
  );

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

        {withGauntlet.length > 0 && (
          <div className="mt-12">
            <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-3">
              Existing Gauntlets
            </div>
            <ResetGauntletList seasons={withGauntlet} />
          </div>
        )}
      </main>
    </div>
  );
}
