import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect, notFound } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { SeasonScheduleDraftEditor } from '@/components/SeasonScheduleDraftEditor';
import { getSeason, getSeasonRoster, getSeasonScheduleDraft, toDraftScheduleWeeks, isPlayerAdmin } from '@/lib/queries';
import { seasonTitle } from '@/lib/util';

export const metadata = {
  title: 'Matchup Draft Editor',
  description: 'Generate or hand-edit a regular season’s matchup schedule.',
};

export default async function SeasonScheduleEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) redirect('/');
  if (!(await isPlayerAdmin(session.user.playerId))) redirect('/');

  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) notFound();

  const season = await getSeason(seasonId);
  if (!season || season.is_gauntlet) notFound();

  const [roster, draft] = await Promise.all([getSeasonRoster(seasonId), getSeasonScheduleDraft(seasonId)]);
  const players = roster.map((r) => ({ id: r.player_id, name: r.player_name }));
  const initialWeeks = toDraftScheduleWeeks(draft);

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Admin', href: '/admin' },
          { label: seasonTitle(season.name), href: `/seasons/${seasonId}` },
          { label: 'Matchup Draft' },
        ]}
      />
      <main className="max-w-[900px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-8">
          <div className="font-display text-[28px] font-semibold leading-tight">Matchup Draft Editor</div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-2">
            {seasonTitle(season.name)} — generate a schedule from the current roster, then hand-edit
            any match before confirming. Confirming requires every roster pair to have played
            together and against each other at least once; nothing here touches the real schedule
            until then.
          </div>
        </div>
        <SeasonScheduleDraftEditor
          // Remounts (discarding client-side edit state) whenever the persisted draft actually
          // changes underneath it — e.g. right after this same editor's own generate/save, via
          // router.refresh(). A plain prop change wouldn't reset useState(initialWeeks).
          key={initialWeeks.map((w) => `${w.week_number}:${w.bye_player_id}:${w.matches.map((m) => `${m.match_number}-${m.shirts.join(',')}-${m.skins.join(',')}`).join('|')}`).join(';')}
          seasonId={seasonId}
          players={players}
          initialWeeks={initialWeeks}
        />
      </main>
    </div>
  );
}
