import Link from 'next/link';
import { getSeasons, getAllLeaderboards } from '@/lib/queries';
import type { LeaderboardRowWithId, Season } from '@/lib/types';
import { TopbarShell } from '@/components/TopbarShell';

export const dynamic = 'force-dynamic';

function podiumSort(rows: LeaderboardRowWithId[]): LeaderboardRowWithId[] {
  return [...rows].sort(
    (a, b) =>
      b.win_rate_percentage - a.win_rate_percentage ||
      b.rwr_percentage - a.rwr_percentage,
  );
}


function HomeTopbar() {
  return (
    <TopbarShell
      crumbs={[{ label: 'DGLS' }]}
      nav={
        <Link
          href="/statistics"
          className="tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Statistics
        </Link>
      }
    />
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="tracked text-[10px] text-[var(--color-text-secondary)] mt-10 mb-3 first:mt-2">
      {children}
    </div>
  );
}

function ActiveSeasonPanel({
  season,
  leaderboard,
}: {
  season: Season;
  leaderboard: LeaderboardRowWithId[];
}) {
  const sorted = podiumSort(leaderboard);
  const hasData = sorted.length > 0 && sorted[0].matches_played > 0;
  const top3 = sorted.slice(0, 3);

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <Link
        href={`/seasons/${season.id}`}
        className="block px-6 py-5 border-b border-[var(--color-border-tertiary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 tracked text-[10px] font-semibold text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border border-[var(--color-accent-green-border)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green-fill)] animate-pulse" />
            Live
          </span>
        </div>
        <div className="font-display text-[32px] font-semibold leading-tight text-[var(--color-text-primary)]">
          {season.name}
        </div>
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5">
          {leaderboard.length} players
        </div>
      </Link>

      {hasData ? (
        <div className="grid grid-cols-3">
          {top3.map((p, i) => (
            <Link
              key={p.player_id}
              href={`/players/${p.player_id}`}
              className="block px-5 py-4 border-r border-[var(--color-border-tertiary)] last:border-r-0 hover:bg-[var(--color-bg-secondary)] transition-colors"
            >
              <div className="tracked text-[9px] text-[var(--color-text-secondary)] mb-1">
                {i === 0 ? 'Leader' : i === 1 ? '2nd' : '3rd'}
              </div>
              <div className="font-display text-[18px] font-semibold leading-tight truncate">
                {p.player_name}
              </div>
              <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1.5 flex items-center gap-3">
                <span>
                  <span className="text-[var(--color-text-primary)] font-semibold">
                    {p.overall_adr.toFixed(1)}
                  </span>
                  <span className="ml-1">ADR</span>
                </span>
                <span>{p.win_rate_percentage.toFixed(1)}% WR</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="px-6 py-5 font-mono text-[12px] text-[var(--color-text-secondary)]">
          No matches played yet.
        </div>
      )}
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
      className="flex items-center justify-between gap-6 px-5 py-4 border-b border-[var(--color-border-tertiary)] last:border-b-0 hover:bg-[var(--color-bg-secondary)] transition-colors"
    >
      <div className="min-w-0">
        <div className="tracked text-[9px] text-[var(--color-accent-blue-fg)] mb-0.5">
          Upcoming
        </div>
        <div className="font-display text-[18px] font-semibold leading-tight truncate">
          {season.name}
        </div>
        {leaderboard.length > 0 && (
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1">
            {leaderboard.length} players
          </div>
        )}
      </div>
      <span className="inline-flex items-center px-1.5 py-0.5 tracked text-[10px] font-semibold text-[var(--color-accent-blue-fg)] bg-[var(--color-accent-blue-bg)] border border-[var(--color-accent-blue-border)] shrink-0">
        Soon
      </span>
    </Link>
  );
}

function PastSeasonRow({
  season,
  leaderboard,
}: {
  season: Season;
  leaderboard: LeaderboardRowWithId[];
}) {
  const sorted = podiumSort(leaderboard);
  const winner = sorted[0];

  return (
    <Link
      href={`/seasons/${season.id}`}
      className="grid grid-cols-[1fr_auto] items-center gap-6 px-5 py-4 border-b border-[var(--color-border-tertiary)] last:border-b-0 hover:bg-[var(--color-bg-secondary)] transition-colors"
    >
      <div className="min-w-0">
        <div className="font-display text-[18px] font-semibold leading-tight truncate">
          {season.name}
        </div>
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1">
          {winner ? (
            <><span className="tracked mr-1">Champion</span>{winner.player_name}</>
          ) : 'No data'} · {leaderboard.length} players
        </div>
      </div>
      {winner && (
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)] flex items-center gap-5">
          <Stat v={`${winner.win_rate_percentage.toFixed(1)}%`} l="WR" />
          <Stat v={winner.overall_adr.toFixed(1)} l="ADR" />
          <Stat v={winner.kd_ratio.toFixed(2)} l="K/D" />
        </div>
      )}
    </Link>
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div className="text-right">
      <div className="font-mono text-[14px] font-semibold text-[var(--color-text-primary)] tnum">
        {v}
      </div>
      <div className="tracked text-[9px] text-[var(--color-text-secondary)]">
        {l}
      </div>
    </div>
  );
}

export default async function Home() {
  const [seasons, leaderboards] = await Promise.all([
    getSeasons(),
    getAllLeaderboards(),
  ]);

  const upcoming = seasons
    .filter((s) => s.status === 'UPCOMING')
    .sort((a, b) => a.id - b.id);
  const active = seasons.filter((s) => s.status === 'ACTIVE');
  const past = seasons
    .filter((s) => s.status === 'ARCHIVED')
    .sort((a, b) => b.id - a.id);

  return (
    <div className="min-h-screen">
      <HomeTopbar />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        {upcoming.length > 0 && (
          <>
            <SectionLabel>Upcoming Seasons</SectionLabel>
            <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
              {upcoming.map((s) => (
                <UpcomingSeasonRow
                  key={s.id}
                  season={s}
                  leaderboard={leaderboards.get(s.id) ?? []}
                />
              ))}
            </div>
          </>
        )}

        <SectionLabel>Active Season</SectionLabel>
        {active.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            No active season.
          </div>
        ) : (
          active.map((s) => (
            <ActiveSeasonPanel
              key={s.id}
              season={s}
              leaderboard={leaderboards.get(s.id) ?? []}
            />
          ))
        )}

        <SectionLabel>Past Seasons</SectionLabel>
        {past.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            No completed seasons yet.
          </div>
        ) : (
          <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
            {past.map((s) => (
              <PastSeasonRow
                key={s.id}
                season={s}
                leaderboard={leaderboards.get(s.id) ?? []}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
