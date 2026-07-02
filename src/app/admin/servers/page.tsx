import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { isPlayerAdmin } from '@/lib/queries';
import { getActiveServerMatch } from '@/lib/dathost-lifecycle';
import { getAdminClient } from '@/lib/supabase-admin';
import { ServerConsolePanel } from '@/components/ServerConsolePanel';

export const metadata = {
  title: 'Match Server',
  description: 'Admin view of the shared DatHost match server.',
};

// Live operational view — don't cache.
export const dynamic = 'force-dynamic';

/**
 * Admin server console (admin console b, #134/#135). Shows the single shared DatHost server's current
 * occupant + a teardown control. Provisioning stays automatic (veto) / on the match page; this is the
 * global operator view and the safety valve for a server left live.
 */
export default async function AdminServersPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) redirect('/');
  if (!(await isPlayerAdmin(session.user.playerId))) redirect('/');

  const active = await getActiveServerMatch(getAdminClient());

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Admin', href: '/admin' }, { label: 'Match Server' }]} />
      <main className="max-w-[760px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[28px] font-semibold leading-tight">Match Server</div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-2">
            The shared DatHost server. Provisioning is automatic when a veto completes; use this to see
            who holds it and to tear it down if it&apos;s stuck live.
          </div>
        </div>
        <ServerConsolePanel active={active} />
      </main>
    </div>
  );
}
