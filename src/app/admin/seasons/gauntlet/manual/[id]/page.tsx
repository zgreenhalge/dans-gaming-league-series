import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect, notFound } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { ManualGauntletBuilder } from '@/components/ManualGauntletBuilder';
import { getSeason, getSeasonLeaderboard, getLinkedGauntlet, getGauntletRounds, isPlayerAdmin } from '@/lib/queries';
import { isPlayedScore } from '@/lib/util';

export const metadata = {
  title: 'Manual Gauntlet Builder',
  description: 'Hand-build gauntlet rounds and matches outside the automated bracket generator.',
};

export default async function ManualGauntletPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) redirect('/');
  if (!(await isPlayerAdmin(session.user.playerId))) redirect('/');

  const { id } = await params;
  const regularSeasonId = Number(id);
  if (!Number.isFinite(regularSeasonId)) notFound();

  const regularSeason = await getSeason(regularSeasonId);
  if (!regularSeason || regularSeason.is_gauntlet) notFound();

  const [leaderboard, gauntletSeason] = await Promise.all([
    getSeasonLeaderboard(regularSeasonId),
    getLinkedGauntlet(regularSeason.name),
  ]);
  const rounds = gauntletSeason ? await getGauntletRounds(gauntletSeason.id) : [];

  const players = leaderboard.map((r) => ({ id: r.player_id, name: r.player_name }));
  const roundSummaries = rounds.map((r) => ({
    round_number: r.round_number,
    matches: r.matches.map((m) => ({
      id: m.id,
      shirts: m.shirts_stats.map((s) => s.player_name),
      skins: m.skins_stats.map((s) => s.player_name),
      played: isPlayedScore(m.final_score),
    })),
  }));

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Admin', href: '/admin' },
          { label: 'Manage Gauntlet', href: '/admin/seasons/gauntlet' },
          { label: 'Manual Builder' },
        ]}
      />
      <main className="max-w-[640px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-8">
          <div className="font-display text-[28px] font-semibold leading-tight">Manual Gauntlet Builder</div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-2">
            {regularSeason.name} — hand-create rounds and matches, bypassing the automated bracket
            generator entirely. No pairing invariant or advancement logic is enforced; each match
            still flows through the normal veto/score routes once created.
          </div>
        </div>
        <ManualGauntletBuilder
          regularSeasonId={regularSeasonId}
          gauntletExists={!!gauntletSeason}
          players={players}
          rounds={roundSummaries}
        />
      </main>
    </div>
  );
}
