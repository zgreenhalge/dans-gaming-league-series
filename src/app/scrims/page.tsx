import type { Metadata } from 'next';
import { TopbarShell } from '@/components/TopbarShell';
import { getSession } from '@/lib/session';
import { getPastScrimNights, getPlayersById, getUpcomingScrimNights } from '@/lib/queries';
import { ScrimNightPanel } from '@/components/ScrimNightPanel';
import { StartScrimNightForm } from '@/components/StartScrimNightForm';
import EmptyState from '@/components/EmptyState';
import { ScrimPastNights } from '@/components/ScrimPastNights';

export const metadata: Metadata = {
  title: 'Scrims',
  description: 'DGLS scrim nights — start one, sign up, check in, and see each night\'s matches and standings.',
};

// Which nights are upcoming, and whether they've started, depend on the current time.
export const dynamic = 'force-dynamic';

const SECTION_LABEL_CLS = 'tracked text-[10px] text-[var(--color-text-secondary)] mb-2';

export default async function ScrimsPage() {
  const now = new Date();
  const [session, upcoming, playersById, pastNights] = await Promise.all([
    getSession(),
    getUpcomingScrimNights(now),
    getPlayersById(),
    getPastScrimNights(now),
  ]);
  const currentPlayerId = session?.user?.playerId ?? null;
  const isAdmin = currentPlayerId != null && !!playersById.get(currentPlayerId)?.is_admin;
  const allPlayers = isAdmin ? [...playersById.values()].map((p) => ({ id: p.id, name: p.name })) : [];

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Scrims' }]} />
      <main className="max-w-[760px] mx-auto px-4 sm:px-6 pb-16">
        <h1 className="mt-8 mb-6 font-display text-[28px] font-semibold leading-tight">Scrims</h1>
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-4">
            <div className={SECTION_LABEL_CLS}>Upcoming nights</div>
            {upcoming.length === 0 && (
              <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
                <EmptyState message="No scrim nights planned — start one." className="px-4 py-6" />
              </div>
            )}
            {upcoming.map((u) => (
              <ScrimNightPanel
                key={u.night.id}
                night={u.night}
                started={u.started}
                checkInOpen={u.checkInOpen}
                signups={u.signups}
                currentPlayerId={currentPlayerId}
                isAdmin={isAdmin}
                allPlayers={allPlayers}
                showNightLink
              />
            ))}
          </section>
          {currentPlayerId != null ? (
            <StartScrimNightForm playerId={currentPlayerId} />
          ) : (
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
              {/* A Route Handler that 302s to Steam, not an app page (see TopbarShell). */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/api/auth/steam" className="underline hover:text-[var(--color-text-primary)]">Log in</a> to start or sign up for a night.
            </div>
          )}
          <section>
            <div className={SECTION_LABEL_CLS}>Past nights</div>
            <ScrimPastNights nights={pastNights} />
          </section>
        </div>
      </main>
    </div>
  );
}
