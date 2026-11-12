import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { LocalTime } from '@/components/LocalTime';
import { RefreshAt } from '@/components/RefreshAt';
import { RefreshOnServerState } from '@/components/RefreshOnServerState';
import { ScrimLobbyPanel } from '@/components/ScrimLobbyPanel';
import { ScrimNightH2H } from '@/components/ScrimNightH2H';
import { ScrimNightStats } from '@/components/ScrimNightStats';
import { ScrimNightTabs, type ScrimNightTabSpec } from '@/components/ScrimNightTabs';
import { UrlStateProvider } from '@/components/UrlStateProvider';
import { ScrimNightRoster } from '@/components/ScrimNightRoster';
import { ScrimNightStatusBar } from '@/components/ScrimNightStatusBar';
import { ScrimNightLeaderboard, ScrimNightMatchList } from '@/components/ScrimNightResults';
import { getSession } from '@/lib/session';
import { getMapsForWorkshopPicker, getPlayersById, hasScrimMatchSabremetrics, scrimLeaderboardToStatLines, getScheduleLabData, getScheduledUnplayedMatches, getScrimNight, getScrimNightById, getScrimNightStatsVersion, getScrimSignups } from '@/lib/queries';
import { scrimNightHref } from '@/lib/crumbs';
import { hasScrimNightEnded, scrimNightBoundaries } from '@/lib/scrim-schedule';
import { LocalDateInTitle } from '@/components/LocalDateInTitle';
import { formatLeagueDate, formatLeagueDateTime, nextRefreshInstant, parseRouteId } from '@/lib/util';
import { buildScrimNightPageModel, scrimNightTabOrder, type ScrimNightTab } from '@/lib/scrim-night-page';

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
  const title = `Scrims · ${formatLeagueDate(night.startsAt)}`;
  const description = `Scrim night · ${formatLeagueDateTime(night.startsAt)} · ${status} — sign up, check in and see the night's results on DGLS.`;
  return {
    title,
    description,
    alternates: { canonical: scrimNightHref(night.id) },
    openGraph: { title: `DGLS · ${title}`, description },
    twitter: { card: 'summary', title: `DGLS · ${title}`, description },
  };
}

const START_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };

export default async function ScrimNightPage({ params }: { params: Promise<{ id: string }> }) {
  const nightId = parseRouteId((await params).id);
  if (nightId === null) notFound();
  const now = new Date();
  const [night, session, playersById, maps, scheduled] = await Promise.all([
    getScrimNight(nightId, now),
    getSession(),
    getPlayersById(),
    getMapsForWorkshopPicker(),
    getScheduledUnplayedMatches(),
  ]);
  if (!night) notFound();

  const dateLabel = formatLeagueDate(night.night.startsAt);
  const currentPlayerId = session?.user?.playerId ?? null;
  const isAdmin = currentPlayerId != null && !!playersById.get(currentPlayerId)?.is_admin;
  const names = Object.fromEntries([...playersById].map(([id, p]) => [id, p.name]));
  const model = buildScrimNightPageModel(night, { playerId: currentPlayerId, isAdmin }, scheduled);
  const { pool, lobbyMatch, scoredMatchIds } = model;
  const [rounds, hasAdvancedStats, statsVersion] = await Promise.all([
    model.offerRounds ? getScheduleLabData(pool.map((p) => p.id)) : null,
    // The Advanced Stats tab shows once a scored match has parsed sabremetrics.
    hasScrimMatchSabremetrics(scoredMatchIds),
    getScrimNightStatsVersion(),
  ]);

  const content: Record<ScrimNightTab, { label: string; content: ReactNode }> = {
    lobby: {
      label: 'Lobby',
      content: (
        <ScrimLobbyPanel
          key={lobbyMatch?.id ?? 'none'}
          nightId={night.night.id}
          match={lobbyMatch}
          queued={model.queued}
          pool={pool}
          names={names}
          maps={maps}
          canMake={model.canMake}
          canEnd={model.canEnd}
          canManage={model.canManageLobby}
          currentPlayerId={currentPlayerId}
          rounds={rounds}
        />
      ),
    },
    roster: {
      label: 'Roster',
      content: (
        <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
          <ScrimNightRoster
            nightId={night.night.id}
            signups={night.signups}
            checkInOpen={night.checkInOpen}
            currentPlayerId={currentPlayerId}
            admin={model.rosterAdmin}
            allPlayers={model.rosterAdmin ? [...playersById.values()].map((p) => ({ id: p.id, name: p.name })) : []}
          />
        </div>
      ),
    },
    matches: {
      label: 'Matches',
      content: <ScrimNightMatchList entries={model.runningOrder} names={names} currentPlayerId={currentPlayerId} />,
    },
    leaderboard: { label: 'Leaderboard', content: <ScrimNightLeaderboard rows={night.leaderboard} /> },
    stats: {
      label: 'Stats',
      content: <ScrimNightStats nightId={night.night.id} version={statsVersion} view="stats" rows={scrimLeaderboardToStatLines(night.leaderboard)} />,
    },
    advanced: { label: 'Advanced Stats', content: <ScrimNightStats nightId={night.night.id} version={statsVersion} view="advanced" /> },
    h2h: { label: 'H2H', content: <ScrimNightH2H data={night.h2h} /> },
  };
  // Check-in opening, the night starting and the night ending all happen on the clock, so the page
  // refreshes itself at the next of them.
  const refreshAt = nextRefreshInstant(scrimNightBoundaries(night.night), now.getTime());
  const tabs: ScrimNightTabSpec[] = scrimNightTabOrder(night, model, hasAdvancedStats).map((key) => ({ key, ...content[key] }));

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Scrims', href: '/scrims' }, { label: dateLabel, localDate: night.night.startsAt }]} />
      <LocalDateInTitle iso={night.night.startsAt} serverLabel={dateLabel} />
      <main className="max-w-[760px] mx-auto px-4 sm:px-6 pb-16">
        <div className="mt-8 mb-6">
          <h1 className="font-display text-[28px] font-semibold leading-tight">Scrim night</h1>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1">
            <LocalTime iso={night.night.startsAt} opts={START_FORMAT} />
          </div>
        </div>

        {/* The night's status, the same over every tab. */}
        <div className="mb-8">
          <ScrimNightStatusBar nightId={night.night.id} startsAt={night.night.startsAt} status={model.status} />
        </div>

        {refreshAt && <RefreshAt iso={refreshAt} serverNow={now.getTime()} />}

        {/* The lobby match's game ending frees the next match, so the page follows its server state
            whichever tab is showing, and its own row, so everyone sees a lobby edit at once. */}
        {lobbyMatch && <RefreshOnServerState matchId={lobbyMatch.id} followMatchRow />}

        {/* A night with no signups and nothing played has no tabs: the status bar is all of it. */}
        {tabs.length > 0 && (
          <Suspense>
            <UrlStateProvider>
              <ScrimNightTabs tabs={tabs} />
            </UrlStateProvider>
          </Suspense>
        )}
      </main>
    </div>
  );
}
