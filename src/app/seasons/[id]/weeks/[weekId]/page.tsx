import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import type { Metadata } from 'next';
import { TopbarShell } from '@/components/TopbarShell';
import { StageHeader } from '@/components/StageHeader';
import { StageNavStrip } from '@/components/StageNavStrip';
import { WeekScorecard } from '@/components/StageScorecard';
import { WeekMatchCard } from '@/components/ScheduleList';
import EmptyState from '@/components/EmptyState';
import { PlayerName } from '@/components/PlayerName';
import { getSeason, getSeasonScope, getWeekRow, getWeekView } from '@/lib/queries';
import { authOptions } from '@/lib/authOptions';
import { buildCrumbs, roundHref, seasonHref, weekHref } from '@/lib/crumbs';
import { describeMatchups } from '@/lib/seo/stage-meta';
import { fmtWindowDate, parseRouteId, seasonTitle, weekWindow } from '@/lib/util';

export const revalidate = 60;

type Params = { id: string; weekId: string };

/** Resolves the URL to its week, redirecting to the canonical URL when the ids disagree with where
 *  the week really lives (a gauntlet round, or a different season's week). The week id is the
 *  authority; the season id in the path is kept readable and corrected rather than trusted. */
const loadWeek = cache(async (idParam: string, weekIdParam: string) => {
  const seasonId = parseRouteId(idParam);
  const weekId = parseRouteId(weekIdParam);
  if (seasonId === null || weekId === null) notFound();
  const row = await getWeekRow(weekId);
  if (!row) notFound();
  const owner = await getSeason(row.season_id);
  if (!owner) notFound();
  const scope = await getSeasonScope(owner);
  if (owner.is_gauntlet) redirect(roundHref(scope.hub.id, weekId));
  if (scope.hub.id !== seasonId) redirect(weekHref(scope.hub.id, weekId));
  const view = await getWeekView(owner.id, weekId);
  if (!view) notFound();
  return { season: owner, view };
});

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id, weekId } = await params;
  const { season, view } = await loadWeek(id, weekId);
  const title = `${seasonTitle(season.name)} · Week ${view.week.week_number}`;
  const matchups = describeMatchups(view.week.matches);
  const description = matchups ? `${title} — ${matchups}` : `${title} — matchups and results in DGLS.`;
  return {
    title,
    description,
    alternates: { canonical: weekHref(season.id, view.week.id) },
    openGraph: { title: `DGLS · ${title}`, description },
    twitter: { card: 'summary_large_image', title: `DGLS · ${title}`, description },
  };
}

export default async function WeekPage({ params }: { params: Promise<Params> }) {
  const { id, weekId } = await params;
  const [{ season, view }, session] = await Promise.all([loadWeek(id, weekId), getServerSession(authOptions)]);
  const currentPlayerId = session?.user?.playerId ?? null;
  const { week } = view;
  const win = weekWindow(season.start_date, week.week_number);

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={buildCrumbs({ season, week: { id: week.id, number: week.week_number } })} />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <StageHeader
          title={`${seasonTitle(season.name)} · Week ${week.week_number}`}
          status={view.status}
          upHref={`${seasonHref(season.id)}?tab=schedule&week=${week.id}`}
          upLabel="Season schedule"
          details={
            <>
              <span>{week.matches.length} matches</span>
              {win && (
                <span>
                  {fmtWindowDate(win.start)} – {fmtWindowDate(win.end)}
                </span>
              )}
              {week.bye_player_name && (
                <span className="inline-flex items-center gap-1">
                  <span className="tracked">Bye</span>
                  <PlayerName name={week.bye_player_name} isMe={currentPlayerId !== null && week.bye_player_id === currentPlayerId} />
                </span>
              )}
            </>
          }
        />
        <div className="mb-6">
          <StageNavStrip nav={view.nav} noun="Weeks" />
        </div>

        <h2 className="tracked text-[11px] font-semibold text-[var(--color-text-secondary)] mb-2">Scorecard</h2>
        <div className="mb-8">
          {view.scorecard.length > 0 ? (
            <WeekScorecard rows={view.scorecard} currentPlayerId={currentPlayerId} />
          ) : (
            <EmptyState message="The scorecard fills in as this week's games are played." size="lg" />
          )}
        </div>

        <h2 className="tracked text-[11px] font-semibold text-[var(--color-text-secondary)] mb-2">Matches</h2>
        {week.matches.length > 0 ? (
          <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
            {week.matches.map((m) => (
              <WeekMatchCard key={m.id} match={m} win={win} currentPlayerId={currentPlayerId} />
            ))}
          </div>
        ) : (
          <EmptyState message="No matches scheduled this week." size="lg" />
        )}
      </main>
    </div>
  );
}
