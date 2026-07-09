import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { OpsErrorList } from '@/components/OpsErrorList';
import { getOpsErrors, isPlayerAdmin } from '@/lib/queries';

export const metadata = {
  title: 'Ops Errors',
  description: 'Every best-effort background operation currently failing or needing admin attention.',
};

export default async function OpsErrorsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) redirect('/');
  if (!(await isPlayerAdmin(session.user.playerId))) redirect('/');

  const opsErrors = await getOpsErrors();

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Admin', href: '/admin' },
          { label: 'Ops Errors' },
        ]}
      />
      <main className="max-w-[640px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-8">
          <div className="font-display text-[28px] font-semibold leading-tight">Ops Errors</div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-2">
            Every best-effort operation (gauntlet build/seed/archive, steam-id learning, server
            teardown, sabremetrics, EHOG recompute) currently failing or needing admin attention —
            never blocks the primary action it rides along with, but is invisible outside this page
            and application logs otherwise.
          </div>
        </div>

        {opsErrors.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">Nothing needs attention.</div>
        ) : (
          <OpsErrorList items={opsErrors} title="Live Errors" />
        )}
      </main>
    </div>
  );
}
