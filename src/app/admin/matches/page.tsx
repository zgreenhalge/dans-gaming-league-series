import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { getAdminMatches, isPlayerAdmin } from '@/lib/queries';
import { MatchManager } from '@/components/MatchManager';

export const metadata = {
  title: 'Manage Matches',
  description: 'Admin match management — reschedule, clear/redo pick-ban, toggle feature match.',
};

// Live operational surface — don't cache.
export const dynamic = 'force-dynamic';

/**
 * Admin match-management console (issue #144). Pick a match and reschedule it, clear/redo its
 * pick-ban, or toggle its feature flag — reusing the same editors and API routes as the match page,
 * so mutation logic isn't duplicated. Score + stats editing stays on the match page (one coupled
 * operation via /score). This server component only gates access and loads the data.
 */
export default async function ManageMatchesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) redirect('/');
  if (!(await isPlayerAdmin(session.user.playerId))) redirect('/');

  const matches = await getAdminMatches();

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Admin', href: '/admin' }, { label: 'Manage Matches' }]} />
      <main className="max-w-[760px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[28px] font-semibold leading-tight">Manage Matches</div>
        </div>

        <MatchManager matches={matches} />
      </main>
    </div>
  );
}
