import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { LocalTime } from '@/components/LocalTime';
import { RefreshAt } from '@/components/RefreshAt';
import { RefreshOnServerState } from '@/components/RefreshOnServerState';
import { ScrimCheckInButton, ScrimLobbyPanel } from '@/components/ScrimLobbyPanel';
import { ScrimNightPanel } from '@/components/ScrimNightPanel';
import { ScrimNightLeaderboard, ScrimNightMatchList } from '@/components/ScrimNightResults';
import { StatusPill } from '@/components/StatusPill';
import { getSession } from '@/lib/session';
import { getMapsForWorkshopPicker, getPlayersById, getScheduleLabData, getScheduledUnplayedMatches, getScrimNight, getScrimNightById, getScrimSignups } from '@/lib/queries';
import { scrimNightHref } from '@/lib/crumbs';
import { SCRIM_CHECK_IN_LEAD_MS, formatNightDate, formatNightStart, hasScrimNightEnded, leagueMatchesDuring } from '@/lib/scrim-schedule';
import { LocalDateInTitle } from '@/components/LocalDateInTitle';
import { parseRouteId } from '@/lib/util';
import { scrimMatchNeedsServer } from '@/lib/scrim-matches';
import { SCRIM_MATCH_SIZE } from '@/lib/scrim-schedule';

// What the night shows (lobby, check-in, live server state) depends on the current time.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const nightId = parseRouteId((await params).id);
  const night = nightId === null ? null : await getScrimNightById(nightId);
  if (!night) return { title: 'Scrims' };
  // A link preview is read wherever it's shared, so it names the start in the league timezone.
  const signups = await getScrimSignups(night.id);
  const definite = signups.filter((s) => s.commitment === 'definite').length;
  const status = hasScrimNightEnded(night, new Date()) ? 'final' : `${definite} definite, ${signups.length - definite} maybe`;
  const title = `Scrims · ${formatNightDate(night.startsAt)}`;
  const description = `Scrim night · ${formatNightStart(night.startsAt)} · ${status} — sign up, check in and see the night's results on DGLS.`;
  return {
    title,
    description,
    alternates: { canonical: scrimNightHref(night.id) },
    openGraph: { title: `DGLS · ${title}`, description },
    twitter: { card: 'summary', title: `DGLS · ${title}`, description },
  };
}

const SECTION_LABEL_CLS = 'tracked text-[10px] text-[var(--color-text-secondary)] mb-2';
const START_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };

export default async function ScrimNightPage({ params }: { params: Promise<{ id: string }> }) {
  const nightId = parseRouteId((await params).id);
  if (nightId === null) notFound();
  const [night, session, playersById, maps, scheduled] = await Promise.all([
    getScrimNight(nightId, new Date()),
    getSession(),
    getPlayersById(),
    getMapsForWorkshopPicker(),
    getScheduledUnplayedMatches(),
  ]);
  if (!night) notFound();

  const dateLabel = formatNightDate(night.night.startsAt);
  const currentPlayerId = session?.user?.playerId ?? null;
  const isAdmin = currentPlayerId != null && !!playersById.get(currentPlayerId)?.is_admin;
  const names = Object.fromEntries([...playersById].map(([id, p]) => [id, p.name]));
  const pool = night.signups.filter((s) => s.checked_in_at).map((s) => ({ id: s.player_id, name: s.player_name }));
  // Matches play in order: the first still needing the server is the lobby's, the rest wait behind it.
  const [lobbyMatch = null, ...queuedMatches] = night.matches.filter(scrimMatchNeedsServer);
  const viewerCheckedIn = currentPlayerId != null && pool.some((p) => p.id === currentPlayerId);
  const inMatch = (m: { shirts: number[]; skins: number[] }) => currentPlayerId != null && [...m.shirts, ...m.skins].includes(currentPlayerId);
  const canMake = isAdmin || viewerCheckedIn;
  // Generate Rounds is offered where Next Match is: no match waiting, four checked in.
  const rounds = night.checkInOpen && canMake && !lobbyMatch && pool.length >= SCRIM_MATCH_SIZE ? await getScheduleLabData(pool.map((p) => p.id)) : null;

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
          {/* Check-in opens on the clock, so the page refreshes itself when it does. */}
          {night.current && !night.checkInOpen && <RefreshAt iso={new Date(Date.parse(night.night.startsAt) - SCRIM_CHECK_IN_LEAD_MS).toISOString()} />}
          {/* Before anyone has checked in there's no lobby yet, only the viewer's own Check in. */}
          {night.checkInOpen && pool.length === 0 && !lobbyMatch && currentPlayerId != null && (
            <div className="flex justify-end">
              <ScrimCheckInButton nightId={night.night.id} viewer={{ playerId: currentPlayerId, checkedIn: false }} />
            </div>
          )}
          {/* The lobby match's game ending frees the next match, so the page follows its server state. */}
          {lobbyMatch && <RefreshOnServerState matchId={lobbyMatch.id} />}
          {night.checkInOpen && (pool.length > 0 || lobbyMatch) && (
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
                canManage={isAdmin}
                currentPlayerId={currentPlayerId}
                viewer={currentPlayerId != null ? { playerId: currentPlayerId, checkedIn: viewerCheckedIn } : null}
                rounds={rounds}
                leagueMatches={leagueMatchesDuring(night.night, scheduled)}
              />
            </section>
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
