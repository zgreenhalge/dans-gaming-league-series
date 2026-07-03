import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { isPlayerAdmin, getMapsForWorkshopPicker } from '@/lib/queries';
import { getActiveServerMatch } from '@/lib/dathost-lifecycle';
import { CONFIG_SET_OPTIONS } from '@/lib/dathost';
import { getAdminClient } from '@/lib/supabase-admin';
import { ServerConsolePanel } from '@/components/ServerConsolePanel';

export const metadata = {
  title: 'Server Console',
  description: 'Admin view of the shared DatHost match server.',
};

// Live operational view — don't cache.
export const dynamic = 'force-dynamic';

/**
 * Admin server console (admin console b, #134/#135). Server-centric: raw DatHost server state +
 * start/stop, manual config-set + map apply, and match occupancy with a teardown control.
 * Per-match provisioning stays automatic (veto) / on the match page; this is the global operator view
 * and the safety valve for a server left live or left in a non-golden state.
 */
export default async function AdminServersPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) redirect('/');
  if (!(await isPlayerAdmin(session.user.playerId))) redirect('/');

  const [active, maps] = await Promise.all([
    getActiveServerMatch(getAdminClient()),
    getMapsForWorkshopPicker(),
  ]);

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Admin', href: '/admin' }, { label: 'Server Console' }]} />
      <main className="max-w-[760px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[28px] font-semibold leading-tight">Server Console</div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-2">
            The shared DatHost server. Provisioning is automatic when a veto completes; use this to
            check its raw state, start/stop it directly, manually apply a config set + map, or tear
            down a match that&apos;s stuck live.
          </div>
        </div>
        <ServerConsolePanel active={active} configSets={CONFIG_SET_OPTIONS} maps={maps} />
      </main>
    </div>
  );
}
