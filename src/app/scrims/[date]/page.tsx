import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { LocalTime } from '@/components/LocalTime';
import { ScrimLobbyPanel } from '@/components/ScrimLobbyPanel';
import { ScrimNightLeaderboard, ScrimNightMatchList } from '@/components/ScrimNightResults';
import { StatusPill } from '@/components/StatusPill';
import { getSession } from '@/lib/session';
import { getMapsForWorkshopPicker, getPlayersById, getScrimNight } from '@/lib/queries';
import { formatNightDate, isNightDate } from '@/lib/scrim-schedule';
import { isPlayedScore } from '@/lib/util';

// What the night shows (lobby, check-in, live server state) depends on the current time.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }): Promise<Metadata> {
  const { date } = await params;
  return { title: isNightDate(date) ? `Scrims · ${formatNightDate(date)}` : 'Scrims' };
}

const SECTION_LABEL_CLS = 'tracked text-[10px] text-[var(--color-text-secondary)] mb-2';
const START_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };

export default async function ScrimNightPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isNightDate(date)) notFound();
  const [night, session, playersById, maps] = await Promise.all([
    getScrimNight(date, new Date()),
    getSession(),
    getPlayersById(),
    getMapsForWorkshopPicker(),
  ]);
  if (!night) notFound();

  const currentPlayerId = session?.user?.playerId ?? null;
  const isAdmin = currentPlayerId != null && !!playersById.get(currentPlayerId)?.is_admin;
  const names = Object.fromEntries([...playersById].map(([id, p]) => [id, p.name]));
  const pool = night.signups.filter((s) => s.checked_in_at).map((s) => ({ id: s.player_id, name: s.player_name }));
  const lobbyMatch = night.matches.find((m) => !isPlayedScore(m.final_score)) ?? null;
  const viewerCheckedIn = currentPlayerId != null && pool.some((p) => p.id === currentPlayerId);
  const inLobbyMatch = currentPlayerId != null && !!lobbyMatch && [...lobbyMatch.shirts, ...lobbyMatch.skins].includes(currentPlayerId);

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Scrims', href: '/scrims' }, { label: formatNightDate(date) }]} />
      <main className="max-w-[760px] mx-auto px-4 sm:px-6 pb-16">
        <div className="mt-8 mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[28px] font-semibold leading-tight">Scrim night</h1>
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1">
              {night.startsAt ? <LocalTime iso={night.startsAt} opts={START_FORMAT} /> : formatNightDate(date)}
            </div>
          </div>
          {night.cancelled ? (
            <StatusPill variant="neutral">Cancelled</StatusPill>
          ) : night.started ? (
            <StatusPill variant="live">Happening now</StatusPill>
          ) : night.current ? (
            <StatusPill variant="accent">Upcoming</StatusPill>
          ) : (
            <StatusPill variant="neutral">Final</StatusPill>
          )}
        </div>

        <div className="flex flex-col gap-8">
          {/* Check-in is only open for a current night that isn't cancelled (`isScrimCheckInOpen()`). */}
          {night.checkInOpen && (
            <section>
              <div className={SECTION_LABEL_CLS}>Lobby</div>
              <ScrimLobbyPanel
                key={lobbyMatch ? `${lobbyMatch.id}:${[...lobbyMatch.shirts, ...lobbyMatch.skins].join(',')}` : 'none'}
                date={date}
                match={lobbyMatch}
                pool={pool}
                names={names}
                maps={maps.map((m) => m.name)}
                canMake={isAdmin || viewerCheckedIn}
                canManage={isAdmin || inLobbyMatch}
              />
              {!viewerCheckedIn && currentPlayerId != null && (
                <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-2">
                  <Link href="/scrims" className="underline hover:text-[var(--color-text-primary)]">Check in</Link> to be matched.
                </div>
              )}
            </section>
          )}
          {night.current && !night.checkInOpen && !night.cancelled && (
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
              The lobby opens when check-in does. <Link href="/scrims" className="underline hover:text-[var(--color-text-primary)]">Sign up</Link> in the meantime.
            </div>
          )}

          <section>
            <div className={SECTION_LABEL_CLS}>Leaderboard</div>
            <ScrimNightLeaderboard rows={night.leaderboard} />
          </section>

          <section>
            <div className={SECTION_LABEL_CLS}>Matches</div>
            <ScrimNightMatchList matches={night.matches} names={names} currentPlayerId={currentPlayerId} />
          </section>
        </div>
      </main>
    </div>
  );
}
