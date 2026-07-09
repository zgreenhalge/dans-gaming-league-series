import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { TopbarShell } from '@/components/TopbarShell';
import { CreateGauntletForm } from '@/components/CreateGauntletForm';
import { GauntletLifecycleList } from '@/components/GauntletLifecycleList';
import { OpsErrorList } from '@/components/OpsErrorList';
import { getSeasons, getGauntletRounds, gauntletHasPods, isPlayerAdmin, getOpsErrors } from '@/lib/queries';
import { buildRegularToGauntletMap, isPlayedScore } from '@/lib/util';

export const metadata = {
  title: 'Start Gauntlet',
  description: 'Build, seed, or reset a gauntlet bracket for an active DGLS season.',
};

export default async function GauntletSeasonPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) redirect('/');
  if (!(await isPlayerAdmin(session.user.playerId))) redirect('/');

  const [seasons, opsErrors] = await Promise.all([getSeasons(), getOpsErrors()]);
  const regularSeasons = seasons.filter((s) => !s.is_gauntlet);
  const gauntletSeasons = seasons.filter((s) => s.is_gauntlet);
  const paired = buildRegularToGauntletMap(regularSeasons, gauntletSeasons);
  const gauntletById = new Map(gauntletSeasons.map((g) => [g.id, g]));

  const seasonOpsErrors = opsErrors.filter((e) => e.entityType === 'season');

  const activeRegular = regularSeasons.filter((s) => s.status === 'ACTIVE');

  const eligible = activeRegular
    .filter((s) => !paired.has(s.id))
    .map((s) => ({ id: s.id, name: s.name }));

  const withGauntlet = await Promise.all(
    activeRegular
      .filter((s) => paired.has(s.id))
      .map(async (s) => {
        const gauntletId = paired.get(s.id)!;
        const [rounds, hasPods] = await Promise.all([getGauntletRounds(gauntletId), gauntletHasPods(gauntletId)]);
        // Round rows only exist once at least one match has materialized — an unseeded automated
        // shape or an empty manual shell both have zero weeks/matches, so getGauntletRounds
        // returns []. hasPods distinguishes the two (manual gauntlets have none).
        const seeded = rounds.length > 0;
        const started = rounds.some((r) => r.matches.some((m) => isPlayedScore(m.final_score)));
        return {
          regularSeasonId: s.id,
          regularSeasonName: s.name,
          gauntletName: gauntletById.get(gauntletId)?.name ?? `Season ${gauntletId} Gauntlet`,
          seeded,
          started,
          manual: !hasPods,
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
            Builds the single-elimination bracket shape for a season — sized from its current
            roster, but unseeded. Seed it later, once the regular season is complete, from the list
            below.
          </div>
        </div>
        <OpsErrorList items={seasonOpsErrors} />

        <CreateGauntletForm seasons={eligible} />

        {eligible.length > 0 && (
          <div className="mt-6 flex flex-col gap-1">
            <div className="tracked text-[9px] text-[var(--color-text-secondary)]">
              Generator doesn&apos;t fit? Build a custom bracket by hand instead:
            </div>
            {eligible.map((s) => (
              <Link
                key={s.id}
                href={`/admin/seasons/gauntlet/manual/${s.id}`}
                className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] underline decoration-dotted w-fit"
              >
                Build {s.name} manually →
              </Link>
            ))}
          </div>
        )}

        {withGauntlet.length > 0 && (
          <div className="mt-12">
            <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-3">
              Existing Gauntlets
            </div>
            <GauntletLifecycleList seasons={withGauntlet} />
          </div>
        )}
      </main>
    </div>
  );
}
