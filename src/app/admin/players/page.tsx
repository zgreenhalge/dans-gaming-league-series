import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { getAdminPlayers, isPlayerAdmin } from '@/lib/queries';
import { PlayerManager } from '@/components/PlayerManager';

export const metadata = {
  title: 'Manage Players',
  description: 'Admin player management — rename, toggle admin, manage Steam links, recompute ratings.',
};

// Live operational surface — don't cache.
export const dynamic = 'force-dynamic';

/**
 * Admin player-management console (issue #144). Rename a player, toggle their `is_admin` flag, or
 * manage their Steam link — plus a manual EHOG rating recompute. This server component only gates
 * access and loads the data; all mutations go through `PATCH /api/players/[id]` and the recompute
 * trigger route.
 */
export default async function ManagePlayersPage() {
  const session = await getServerSession(authOptions);
  const selfId = session?.user?.playerId ?? null;
  if (!selfId) redirect('/');
  if (!(await isPlayerAdmin(selfId))) redirect('/');

  const players = await getAdminPlayers();

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Admin', href: '/admin' }, { label: 'Manage Players' }]} />
      <main className="max-w-[760px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[28px] font-semibold leading-tight">Manage Players</div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-2">
            Rename a player, grant or remove admin access, and manage Steam links. Force an EHOG rating
            recompute below.
          </div>
        </div>

        <PlayerManager players={players} selfId={selfId} />
      </main>
    </div>
  );
}
