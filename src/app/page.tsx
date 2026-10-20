import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import {
  getSeasons,
  getAllLeaderboards,
  getSeasonForm,
  getHomeGames,
  resolveHomeSeasons,
  getMyStats,
  getCareerH2HDataCached,
  getPlayerRosterSeasonIds,
  getOpenFeedbackSeasonIds,
  getSeasonSurveyView,
  getSeasonSuperlativesView,
} from '@/lib/queries';
import type { LeaderboardRowWithId, Season } from '@/lib/types';
import { gauntletHref, seasonHref } from '@/lib/crumbs';
import { TopbarShell } from '@/components/TopbarShell';
import { seasonTitle } from '@/lib/util';
import { UpcomingSeasonTag } from '@/components/UpcomingSeasonTag';
import { FeedbackBanner } from '@/components/FeedbackBanner';
import { UpcomingGamesPanel } from '@/components/UpcomingGamesPanel';
import { HomeStandingsPanel } from '@/components/HomeStandingsPanel';
import { MyStatsPanel, MyStatsLockedPanel } from '@/components/MyStatsPanel';
import { TopDuosPanel, HottestRivalriesPanel } from '@/components/TopPairsPanels';

export const dynamic = 'force-dynamic';

function HomeTopbar() {
  return <TopbarShell crumbs={[{ label: 'DGLS' }]} />;
}

function UpcomingSeasonRow({
  season,
  leaderboard,
  needsSignup,
}: {
  season: Season;
  leaderboard: LeaderboardRowWithId[];
  needsSignup: boolean;
}) {
  return (
    <Link
      href={seasonHref(season.id)}
      className="lift-row flex items-center justify-between gap-6 px-5 py-4 border-b border-[var(--color-border-tertiary)] last:border-b-0"
    >
      <div className="min-w-0">
        <div className="tracked text-[9px] mb-0.5" style={{ color: 'var(--color-site-accent)' }}>
          Upcoming
        </div>
        <div className="font-display text-[18px] font-semibold leading-tight truncate">
          {seasonTitle(season.name)}
        </div>
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1">
          {[
            leaderboard.length > 0 && `${leaderboard.length} players`,
            season.start_date && new Date(season.start_date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
          ].filter(Boolean).join(' · ')}
        </div>
      </div>
      <UpcomingSeasonTag needsSignup={needsSignup} />
    </Link>
  );
}

export default async function Home() {
  const session = await getServerSession(authOptions);
  const currentPlayerId = session?.user?.playerId ?? null;
  const [seasons, leaderboards, rosterSeasonIds, h2h, openFeedbackIds] = await Promise.all([
    getSeasons(),
    getAllLeaderboards(),
    currentPlayerId != null ? getPlayerRosterSeasonIds(currentPlayerId) : new Set<number>(),
    getCareerH2HDataCached(),
    currentPlayerId != null ? getOpenFeedbackSeasonIds().then((ids) => new Set(ids)) : new Set<number>(),
  ]);

  const upcoming = seasons
    .filter((s) => !s.is_gauntlet && s.status === 'UPCOMING')
    .sort((a, b) => a.id - b.id);

  // Games (Upcoming Games + To Be Scheduled) come from the active regular season, else the active
  // gauntlet; standings from the active regular season, else the latest finished one.
  const home = resolveHomeSeasons(seasons);
  const { standings } = home;

  // Survey / superlatives banners for the signed-in player: only seasons with something open, and
  // only those the player played (the views are null otherwise).
  const feedbackSeasons = seasons
    .filter((s) => !s.is_gauntlet && openFeedbackIds.has(s.id))
    .sort((a, b) => b.id - a.id);

  const [myStats, games, form, feedbackViews] = await Promise.all([
    currentPlayerId != null ? getMyStats(currentPlayerId, h2h) : null,
    getHomeGames(home),
    standings ? getSeasonForm(standings.season.id) : new Map<number, boolean[]>(),
    Promise.all(
      feedbackSeasons.map(async (s) => {
        const [survey, superlatives] = await Promise.all([
          getSeasonSurveyView(s.id, currentPlayerId),
          getSeasonSuperlativesView(s.id, currentPlayerId),
        ]);
        return { season: s, survey, superlatives };
      }),
    ),
  ]);
  const feedbackBanners = feedbackViews.filter((b) => b.survey || b.superlatives?.mode === 'ballot');

  return (
    <div className="min-h-screen">
      <HomeTopbar />
      <main className="max-w-[1080px] mx-auto px-6 pt-6 pb-16">
        {feedbackBanners.map((b) => (
          <FeedbackBanner
            key={b.season.id}
            seasonId={b.season.id}
            seasonName={seasonTitle(b.season.name)}
            survey={b.survey}
            superlatives={b.superlatives}
            alwaysPrompt
          />
        ))}
        {upcoming.length > 0 && (
          <div className="mb-8 border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
            {upcoming.map((s) => (
              <UpcomingSeasonRow
                key={s.id}
                season={s}
                leaderboard={leaderboards.get(s.id) ?? []}
                needsSignup={!rosterSeasonIds.has(s.id)}
              />
            ))}
          </div>
        )}

        {/* One grid, so My Stats is a single element: first on a phone (above the games and
            standings) and top of the right-hand column on a wide screen, where the games and
            standings column spans the rail's two rows. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr]">
          <div className="min-w-0 lg:col-start-2 lg:row-start-1">
            {myStats ? <MyStatsPanel stats={myStats} /> : <MyStatsLockedPanel />}
          </div>
          <div className="min-w-0 flex flex-col gap-6 lg:col-start-1 lg:row-start-1 lg:row-span-2">
            {games && (
              <UpcomingGamesPanel
                scheduled={games.scheduled}
                unscheduled={games.unscheduled}
                headingHref={games.headingHref}
                scheduleHref={games.scheduleHref}
                currentPlayerId={currentPlayerId}
              />
            )}
            {standings && (
              <HomeStandingsPanel
                title={seasonTitle(standings.season.name)}
                seasonHref={seasonHref(standings.season.id)}
                live={standings.live}
                gauntletHref={standings.gauntlet ? gauntletHref(standings.season.id) : undefined}
                rows={leaderboards.get(standings.season.id) ?? []}
                form={form}
                currentPlayerId={currentPlayerId}
              />
            )}
          </div>
          <div className="min-w-0 flex flex-col gap-4 self-start lg:col-start-2 lg:row-start-2 empty:hidden">
            <TopDuosPanel data={h2h} />
            <HottestRivalriesPanel data={h2h} />
          </div>
        </div>
      </main>
    </div>
  );
}
