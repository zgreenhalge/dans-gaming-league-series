import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getSeasons, getAllLeaderboards, getSeasonSchedule } from '@/lib/queries';
import type { MatchWithRoster, WeekWithMatches } from '@/lib/queries';
import type { LeaderboardRowWithId, Season } from '@/lib/types';
import { TopbarShell } from '@/components/TopbarShell';
import { seasonTitle } from '@/lib/util';
import { NextUpPanel } from '@/components/NextUpPanel';
import { NextWeekPanel } from '@/components/NextWeekPanel';

export const dynamic = 'force-dynamic';

function weekWindowMs(startDate: string, weekNumber: number): { start: number; end: number } {
  const [y, m, d] = startDate.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  return {
    start: base + (weekNumber - 1) * 7 * 86_400_000,
    end: base + ((weekNumber - 1) * 7 + 6) * 86_400_000 + 86_399_999,
  };
}

function findCurrentWeek(schedule: WeekWithMatches[], startDate: string | null): WeekWithMatches | null {
  if (schedule.length === 0) return null;

  if (startDate) {
    const now = Date.now();
    // Week whose window contains today
    const current = schedule.find((w) => {
      const win = weekWindowMs(startDate, w.week_number);
      return now >= win.start && now <= win.end;
    });
    if (current) return current;
    // Today is before the first week or between weeks — return the next upcoming week
    const next = schedule.find((w) => {
      const win = weekWindowMs(startDate, w.week_number);
      return now < win.start;
    });
    if (next) return next;
    // All week windows are past — return the last week
    return schedule[schedule.length - 1];
  }

  // No start_date: fall back to first week with any matches
  return schedule[0];
}

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
        </div>
        <div className="font-display text-[32px] font-semibold leading-tight text-[var(--color-text-primary)]">
          {seasonTitle(season.name)}
        </div>
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5">
          {leaderboard.length} players
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

  // Fetch schedule for the first active season to power the This Week + Next Week panels
  let nextUpWeek: WeekWithMatches | null = null;
  let nextUpMatches: MatchWithRoster[] = [];
  let nextUpSeason: Season | null = null;
  let followingWeek: WeekWithMatches | null = null;
  if (active.length > 0) {
    const activeSeason = active[0];
    const schedule = await getSeasonSchedule(activeSeason.id);
    const currentWeek = findCurrentWeek(schedule, activeSeason.start_date);
    if (currentWeek && currentWeek.matches.length > 0) {
      nextUpWeek = currentWeek;
      nextUpMatches = [...currentWeek.matches].sort((a, b) => a.match_number - b.match_number);
      nextUpSeason = activeSeason;
      const idx = schedule.indexOf(currentWeek);
      const candidate = idx >= 0 ? schedule[idx + 1] ?? null : null;
      if (candidate && candidate.matches.some((m) => m.shirts.length > 0 || m.skins.length > 0)) {
        followingWeek = candidate;
      }
    }
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

        {active.map((s) => (
          <ActiveSeasonPanel
            key={s.id}
            season={s}
            leaderboard={leaderboards.get(s.id) ?? []}
          />
        ))}

        {nextUpWeek && nextUpSeason && (
          <div className="mt-4">
            <NextUpPanel
              season={nextUpSeason}
              week={nextUpWeek}
              matches={nextUpMatches}
              currentPlayerId={currentPlayerId}
            />
          </div>
        )}

        {followingWeek && nextUpSeason && (
          <div className="mt-4">
            <NextWeekPanel
              season={nextUpSeason}
              week={followingWeek}
              currentPlayerId={currentPlayerId}
            />
          </div>
        )}
      </main>
    </div>
  );
}
