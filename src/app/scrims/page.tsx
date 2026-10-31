import type { Metadata } from 'next';
import { TopbarShell } from '@/components/TopbarShell';
import { getSession } from '@/lib/session';
import { getPlayersById, getScrimOverview } from '@/lib/queries';
import { hasScrimNightStarted } from '@/lib/scrim-schedule';
import { ScrimNightPanel } from '@/components/ScrimNightPanel';
import { ScrimAdminPanel } from '@/components/ScrimAdminPanel';
import EmptyState from '@/components/EmptyState';

export const metadata: Metadata = {
  title: 'Scrims',
  description: 'Weekly DGLS scrim nights — sign up as definite or maybe and see who is coming.',
};

// Which night is next, and whether it has started, depend on the current time.
export const dynamic = 'force-dynamic';

/** Every IANA zone this runtime knows, plus `UTC` (which `supportedValuesOf` can omit) and the saved
 *  zone, so the picker can always show the current value. */
function timezoneOptions(current: string | undefined): string[] {
  return [...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC', ...(current ? [current] : [])])].sort();
}

export default async function ScrimsPage() {
  const now = new Date();
  const [session, overview, playersById] = await Promise.all([getSession(), getScrimOverview(now), getPlayersById()]);
  const currentPlayerId = session?.user?.playerId ?? null;
  const isAdmin = currentPlayerId != null && !!playersById.get(currentPlayerId)?.is_admin;
  const { schedule, slots, next, signups } = overview;

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Scrims' }]} />
      <main className="max-w-[760px] mx-auto px-4 sm:px-6 pb-16">
        <h1 className="mt-8 mb-6 font-display text-[28px] font-semibold leading-tight">Scrims</h1>
        <div className="flex flex-col gap-6">
          {next ? (
            <ScrimNightPanel
              key={next.date}
              night={next}
              started={hasScrimNightStarted(next, now)}
              signups={signups}
              currentPlayerId={currentPlayerId}
              isAdmin={isAdmin}
              allPlayers={isAdmin ? [...playersById.values()].map((p) => ({ id: p.id, name: p.name })) : []}
            />
          ) : (
            <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
              <EmptyState message="No scrims scheduled right now." className="px-4 py-6" />
            </div>
          )}
          {currentPlayerId == null && next && (
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
              {/* A Route Handler that 302s to Steam, not an app page (see TopbarShell). */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/api/auth/steam" className="underline hover:text-[var(--color-text-primary)]">Log in</a> to sign up.
            </div>
          )}
          {isAdmin && <ScrimAdminPanel schedule={schedule} slots={slots} timezones={timezoneOptions(schedule?.timezone)} />}
        </div>
      </main>
    </div>
  );
}
