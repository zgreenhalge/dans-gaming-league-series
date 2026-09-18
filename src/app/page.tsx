import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import {
  getSeasons,
  getAllLeaderboards,
  getSeasonSchedule,
  getUpcomingGames,
  getGauntletRounds,
  getUpcomingGauntletGames,
  gauntletMatchToUpcomingGameRow,
} from '@/lib/queries';
import type { UpcomingGameRow } from '@/lib/queries';
import type { LeaderboardRowWithId, Season } from '@/lib/types';
import { TopbarShell } from '@/components/TopbarShell';
import { seasonTitle } from '@/lib/util';
import { UpcomingGamesPanel } from '@/components/UpcomingGamesPanel';

export const dynamic = 'force-dynamic';

function HomeTopbar() {
  return <TopbarShell crumbs={[{ label: 'DGLS' }]} />;
}

function ActiveSeasonPanel({
  season,
  leaderboard,
}: {
  season: Season;
  leaderboard: LeaderboardRowWithId[];
}) {
  // seasonTitle() collapses both a regular season and its paired gauntlet to the same "Season N" —
  // fine everywhere else since context disambiguates, but here they can both render as Live tiles
  // at once, so the gauntlet keeps its full name ("Season N Gauntlet") to stay distinguishable.
  // Linking to the gauntlet's own id is enough — the season page itself redirects a gauntlet id to
  // its paired regular season and renders the gauntlet tab inline.
  return (
    <div
      className="lift-card border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]"
      style={{ borderLeftColor: 'var(--color-site-accent)', borderLeftWidth: '3px' }}
    >
      <Link
        href={`/seasons/${season.id}`}
        className="block px-6 py-5 hover:bg-[var(--color-bg-secondary)] transition-colors"
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 tracked text-[10px] font-semibold text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border border-[var(--color-accent-green-border)]">
            <span className="live-dot w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green-fill)]" />
            Live
          </span>
          {season.is_gauntlet && (
            <span className="inline-flex items-center px-1.5 py-0.5 tracked text-[10px] font-semibold text-[var(--color-accent-amber-fg)] bg-[var(--color-accent-amber-bg)] border border-[var(--color-accent-amber-border)]">
              Gauntlet
            </span>
          )}
        </div>
        <div className="font-display text-[32px] font-semibold leading-tight text-[var(--color-text-primary)]">
          {season.is_gauntlet ? season.name : seasonTitle(season.name)}
        </div>
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5">
          {season.is_gauntlet ? 'In progress' : `${leaderboard.length} players`}
        </div>
      </Link>
    </div>
  );
}

function UpcomingSeasonRow({
  season,
  leaderboard,
}: {
  season: Season;
  leaderboard: LeaderboardRowWithId[];
}) {
  return (
    <Link
      href={`/seasons/${season.id}`}
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
      <span
        className="inline-flex items-center px-1.5 py-0.5 tracked text-[10px] font-semibold border shrink-0"
        style={{
          color: 'var(--color-site-accent)',
          background: 'color-mix(in srgb, var(--color-site-accent) 12%, transparent)',
          borderColor: 'var(--color-site-accent)',
        }}
      >
        Soon
      </span>
    </Link>
  );
}

export default async function Home() {
  const [seasons, leaderboards, session] = await Promise.all([
    getSeasons(),
    getAllLeaderboards(),
    getServerSession(authOptions),
  ]);
  const currentPlayerId = session?.user?.playerId ?? null;

  const upcoming = seasons
    .filter((s) => !s.is_gauntlet && s.status === 'UPCOMING')
    .sort((a, b) => a.id - b.id);
  const active = seasons.filter((s) => !s.is_gauntlet && s.status === 'ACTIVE');
  // Kept separate from `active` rather than merged in: a gauntlet has no weekly schedule (no
  // `start_date`, no week/match structure), so it only ever drives its own Live tile, never the
  // Upcoming Games panel's "first active regular season" pick below.
  const activeGauntlets = seasons.filter((s) => s.is_gauntlet && s.status === 'ACTIVE');

  // Upcoming Games panel data, from whichever season is actually active — a regular season anchors
  // "needs scheduling" on its current week (getUpcomingGames()); a gauntlet has no weekly structure
  // to anchor that on, so it surfaces every unscheduled bracket match instead
  // (getUpcomingGauntletGames()).
  let upcomingScheduled: UpcomingGameRow[] = [];
  let upcomingUnscheduled: UpcomingGameRow[] = [];
  if (active.length > 0) {
    const schedule = await getSeasonSchedule(active[0].id);
    const upcomingGames = getUpcomingGames(schedule, active[0].start_date);
    upcomingScheduled = upcomingGames.scheduled;
    upcomingUnscheduled = upcomingGames.unscheduled;
  } else if (activeGauntlets.length > 0) {
    const rounds = await getGauntletRounds(activeGauntlets[0].id);
    const upcomingGames = getUpcomingGauntletGames(rounds);
    upcomingScheduled = upcomingGames.scheduled.map(gauntletMatchToUpcomingGameRow);
    upcomingUnscheduled = upcomingGames.unscheduled.map(gauntletMatchToUpcomingGameRow);
  }

  return (
    <div className="min-h-screen">
      <HomeTopbar />
      <main className="max-w-[1080px] mx-auto px-6 pt-6 pb-16">
        {upcoming.length > 0 && (
          <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
            {upcoming.map((s) => (
              <UpcomingSeasonRow
                key={s.id}
                season={s}
                leaderboard={leaderboards.get(s.id) ?? []}
              />
            ))}
          </div>
        )}

        {[...active, ...activeGauntlets].map((s) => (
          <ActiveSeasonPanel
            key={s.id}
            season={s}
            leaderboard={leaderboards.get(s.id) ?? []}
          />
        ))}

        {(upcomingScheduled.length > 0 || upcomingUnscheduled.length > 0) && (
          <div className="mt-4">
            <UpcomingGamesPanel
              scheduled={upcomingScheduled}
              unscheduled={upcomingUnscheduled}
              currentPlayerId={currentPlayerId}
            />
          </div>
        )}
      </main>
    </div>
  );
}
