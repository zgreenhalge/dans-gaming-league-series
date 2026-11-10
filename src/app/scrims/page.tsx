import type { Metadata } from 'next';
import { TopbarShell } from '@/components/TopbarShell';
import { getSession } from '@/lib/session';
import { getPastScrimNights, getPlayersById, getUpcomingScrimNights } from '@/lib/queries';
import { ScrimCalendar } from '@/components/ScrimCalendar';
import { ScrimPastNights } from '@/components/ScrimPastNights';
import SectionLabel from '@/components/SectionLabel';
import { RefreshAt } from '@/components/RefreshAt';
import { scrimNightBoundaries } from '@/lib/scrim-schedule';
import { nextRefreshInstant } from '@/lib/util';

export const metadata: Metadata = {
  title: 'Scrims',
  description: 'DGLS scrim nights — start one, sign up, check in, and see each night\'s matches and standings.',
};

// Which nights are upcoming, and whether they've started, depend on the current time.
export const dynamic = 'force-dynamic';

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
  // Check-in opening, a night starting and a night ending all change the page, so it refreshes
  // itself at the next of them.
  const refreshAt = nextRefreshInstant(upcoming.flatMap((u) => scrimNightBoundaries(u.night)), now.getTime());

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Scrims' }]} />
      {refreshAt && <RefreshAt iso={refreshAt} serverNow={now.getTime()} />}
      <main className="max-w-[760px] mx-auto px-4 sm:px-6 pb-16">
        <h1 className="mt-8 mb-6 font-display text-[28px] font-semibold leading-tight">Scrims</h1>
        <div className="flex flex-col gap-6">
          <ScrimCalendar upcoming={upcoming} past={pastNights} currentPlayerId={currentPlayerId} isAdmin={isAdmin} allPlayers={allPlayers} />
          <section>
            <SectionLabel className="mb-2">Past nights</SectionLabel>
            <ScrimPastNights nights={pastNights} />
          </section>
        </div>
      </main>
    </div>
  );
}
