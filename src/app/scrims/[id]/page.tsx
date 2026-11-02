import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { LocalTime } from '@/components/LocalTime';
import { ScrimLobbyPanel } from '@/components/ScrimLobbyPanel';
import { ScrimNightPanel } from '@/components/ScrimNightPanel';
import { ScrimPreMatchPanel } from '@/components/ScrimPreMatchPanel';
import { ScrimNightLeaderboard, ScrimNightMatchList } from '@/components/ScrimNightResults';
import { StatusPill } from '@/components/StatusPill';
import { getSession } from '@/lib/session';
import { getMapsForWorkshopPicker, getPlayersById, getScheduleLabData, getScrimNight, getScrimNightById } from '@/lib/queries';
import { formatNightDate } from '@/lib/scrim-schedule';
import { LocalDateInTitle } from '@/components/LocalDateInTitle';
import { isPlayedScore, parseRouteId } from '@/lib/util';
import { SCRIM_MATCH_SIZE } from '@/lib/scrim-matchmaking';

// What the night shows (lobby, check-in, live server state) depends on the current time.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const nightId = parseRouteId((await params).id);
  const night = nightId === null ? null : await getScrimNightById(nightId);
  return { title: night ? `Scrims · ${formatNightDate(night.startsAt)}` : 'Scrims' };
}

const SECTION_LABEL_CLS = 'tracked text-[10px] text-[var(--color-text-secondary)] mb-2';
const START_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };

export default async function ScrimNightPage({ params }: { params: Promise<{ id: string }> }) {
  const nightId = parseRouteId((await params).id);
  if (nightId === null) notFound();
  const [night, session, playersById, maps] = await Promise.all([
    getScrimNight(nightId, new Date()),
    getSession(),
    getPlayersById(),
    getMapsForWorkshopPicker(),
  ]);
  if (!night) notFound();

  const dateLabel = formatNightDate(night.night.startsAt);
  const currentPlayerId = session?.user?.playerId ?? null;
  const isAdmin = currentPlayerId != null && !!playersById.get(currentPlayerId)?.is_admin;
  const names = Object.fromEntries([...playersById].map(([id, p]) => [id, p.name]));
  const pool = night.signups.filter((s) => s.checked_in_at).map((s) => ({ id: s.player_id, name: s.player_name }));
  // Matches play in order: the first without a score is the lobby's, the rest wait behind it.
  const [lobbyMatch = null, ...queuedMatches] = night.matches.filter((m) => !isPlayedScore(m.final_score));
  const viewerCheckedIn = currentPlayerId != null && pool.some((p) => p.id === currentPlayerId);
  const inMatch = (m: { shirts: number[]; skins: number[] }) => currentPlayerId != null && [...m.shirts, ...m.skins].includes(currentPlayerId);
  const inLobbyMatch = !!lobbyMatch && inMatch(lobbyMatch);
  const canMake = isAdmin || viewerCheckedIn;
  // Pre-matching rounds is offered where making the next match is: no match waiting, four checked in.
  const preMatch = night.checkInOpen && canMake && !lobbyMatch && pool.length >= SCRIM_MATCH_SIZE ? await getScheduleLabData(pool.map((p) => p.id)) : null;

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Scrims', href: '/scrims' }, { label: dateLabel, localDate: night.night.startsAt }]} />
      <LocalDateInTitle iso={night.night.startsAt} serverLabel={dateLabel} />
      <main className="max-w-[760px] mx-auto px-4 sm:px-6 pb-16">
        <div className="mt-8 mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[28px] font-semibold leading-tight">Scrim night</h1>
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1">
              <LocalTime iso={night.night.startsAt} opts={START_FORMAT} />
            </div>
          </div>
          {night.started && night.current ? (
            <StatusPill variant="live">Happening now</StatusPill>
          ) : night.current ? (
            <StatusPill variant="accent">Upcoming</StatusPill>
          ) : (
            <StatusPill variant="neutral">Final</StatusPill>
          )}
        </div>

        <div className="flex flex-col gap-8">
          {night.current && (
            <ScrimNightPanel
              upcoming={night}
              currentPlayerId={currentPlayerId}
              isAdmin={isAdmin}
              allPlayers={isAdmin ? [...playersById.values()].map((p) => ({ id: p.id, name: p.name })) : []}
            />
          )}
          {night.checkInOpen && (
            <section>
              <div className={SECTION_LABEL_CLS}>Lobby</div>
              <ScrimLobbyPanel
                key={lobbyMatch ? `${lobbyMatch.id}:${lobbyMatch.workshop_id}:${[...lobbyMatch.shirts, ...lobbyMatch.skins].join(',')}` : 'none'}
                nightId={night.night.id}
                match={lobbyMatch}
                queued={queuedMatches.map((m) => ({ match: m, canDiscard: isAdmin || inMatch(m) }))}
                pool={pool}
                names={names}
                maps={maps}
                canMake={canMake}
                canManage={isAdmin || inLobbyMatch}
              />
              {preMatch && (
                <div className="mt-3 flex flex-col">
                  <ScrimPreMatchPanel
                    nightId={night.night.id}
                    players={preMatch.players}
                    rosters={preMatch.rosters}
                    careerRecords={preMatch.careerRecords}
                  />
                </div>
              )}
              {!viewerCheckedIn && currentPlayerId != null && (
                <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-2">Check in above to be matched.</div>
              )}
            </section>
          )}
          {night.current && !night.checkInOpen && (
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">The lobby opens when check-in does.</div>
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
