import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { TopbarShell } from '@/components/TopbarShell';
import { isPlayerAdmin } from '@/lib/queries';

export const metadata = {
  title: 'Admin',
  description: 'DGLS admin tools.',
};

// Central admin hub. Add a tool by dropping an entry in `TOOLS` — each links to an
// existing admin-gated page (every target re-checks `isPlayerAdmin` server-side, so
// this hub is a convenience surface, not the security boundary).
const TOOLS: { href: string; title: string; desc: string }[] = [
  {
    href: '/admin/jobs',
    title: 'Background Jobs',
    desc: 'Every pipeline — demo ingest, replay, and radar — with status, warnings, and retry.',
  },
  {
    href: '/admin/matches',
    title: 'Manage Matches',
    desc: 'Reschedule, clear/redo a pick-ban, and toggle the feature match from one place.',
  },
  {
    href: '/admin/servers',
    title: 'Match Server',
    desc: 'Shared DatHost server status — who holds it, and a teardown control.',
  },
  {
    href: '/admin/seasons/new',
    title: 'Create Season',
    desc: 'Start a new regular season with its map pool.',
  },
];

export default async function AdminHubPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) redirect('/');
  if (!(await isPlayerAdmin(session.user.playerId))) redirect('/');

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Admin' }]} />
      <main className="max-w-[760px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[28px] font-semibold leading-tight">Admin</div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-2">
            Tools for running the league.
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {TOOLS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="lift-card block border border-[var(--color-border-tertiary)] rounded px-4 py-4"
            >
              <div className="font-display text-[17px] font-semibold">{t.title}</div>
              <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1">
                {t.desc}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
