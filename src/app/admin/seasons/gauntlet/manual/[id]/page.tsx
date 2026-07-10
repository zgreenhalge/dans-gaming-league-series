import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect, notFound } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { GauntletPodEditor } from '@/components/GauntletPodEditor';
import { getSeason, getSeasonLeaderboard, getLinkedGauntlet, getGauntletBracketShape, isPlayerAdmin } from '@/lib/queries';
import { buildGauntletBracket } from '@/lib/gauntlet-bracket';
import { fromPersistedShape, fromGeneratedPlan, emptyDraftPod, type DraftPod } from '@/lib/gauntlet-draft';

export const metadata = {
  title: 'Gauntlet Bracket Editor',
  description: 'Hand-build or extend a gauntlet bracket, pod by pod.',
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
  const players = leaderboard.map((r) => ({ id: r.player_id, name: r.player_name }));

  // Loading the initial draft: an already-persisted shape (in-progress manual gauntlet, or a
  // generator-built one the admin now wants to keep hand-editing) always wins; otherwise default to
  // the same generated plan the generator's own preview would show (identical by construction, no
  // data transfer needed from that flow), or — for a qualifier count outside buildGauntletBracket's
  // supported range — a single empty round with one empty pod.
  let initialDraft: DraftPod[];
  if (gauntletSeason) {
    initialDraft = fromPersistedShape(await getGauntletBracketShape(gauntletSeason.id));
  } else {
    try {
      initialDraft = fromGeneratedPlan(buildGauntletBracket(players.length), leaderboard);
    } catch {
      initialDraft = [emptyDraftPod('1:0', 1, 0)];
    }
  }

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Admin', href: '/admin' },
          { label: 'Manage Gauntlet', href: '/admin/seasons/gauntlet' },
          { label: 'Bracket Editor' },
        ]}
      />
      <main className="max-w-[900px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-8">
          <div className="font-display text-[28px] font-semibold leading-tight">Gauntlet Bracket Editor</div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-2">
            {regularSeason.name} — add, edit, or remove pods by hand. A pod materializes into real
            matches the instant all 4 of its slots are decided; once that happens it&apos;s locked here.
            Nothing is saved until you review and confirm the bracket.
          </div>
        </div>
        <GauntletPodEditor
          // Remounts (discarding client-side edit state) whenever the persisted shape actually
          // changes underneath it — e.g. right after this same editor's own save, via
          // `router.refresh()`. A plain prop change wouldn't reset `useState(initialPods)`.
          key={initialDraft.map((p) => p.key).join(',')}
          regularSeasonId={regularSeasonId}
          players={players}
          initialPods={initialDraft}
        />
      </main>
    </div>
  );
}
