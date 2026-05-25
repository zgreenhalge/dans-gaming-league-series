import Link from 'next/link';
import { getSeasons, getAllLeaderboards } from '@/lib/queries';
import type { LeaderboardRowWithId, Season } from '@/lib/types';

export const revalidate = 60;

const MEDALS = ['🥇', '🥈', '🥉'];

function podiumSort(rows: LeaderboardRowWithId[]): LeaderboardRowWithId[] {
  return [...rows].sort(
    (a, b) =>
      b.win_rate_percentage - a.win_rate_percentage ||
      b.overall_adr - a.overall_adr,
  );
}

function Topbar() {
  return (
    <div className="flex items-center justify-between px-5 py-2.5 bg-[var(--color-bg-primary)] border-b border-[var(--color-border-tertiary)] sticky top-0 z-10">
      <span className="text-xs font-medium tracking-wider text-[var(--color-text-secondary)]">
        <span className="text-[var(--color-text-primary)]">DGLS</span> · Dan&apos;s
        Gaming League Series
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium tracking-wider text-[var(--color-text-secondary)] mt-5 mb-2.5 uppercase first:mt-0">
      {children}
    </div>
  );
}

function PodiumStrip({ top3 }: { top3: LeaderboardRowWithId[] }) {
  return (
    <div className="flex items-stretch">
      {top3.map((p, i) => (
        <Link
          key={p.player_id}
          href={`/players/${p.player_id}`}
          className="flex-1 px-3 py-2.5 flex flex-col items-center justify-center gap-0.5 border-r border-[var(--color-border-tertiary)] last:border-r-0 hover:bg-[var(--color-bg-secondary)] transition-colors"
        >
          <div className="text-sm leading-none">{MEDALS[i]}</div>
          <div className="text-[13px] font-medium">{p.player_name}</div>
          <div className="text-[11px] text-[var(--color-text-secondary)] tnum">
            {p.win_rate_percentage.toFixed(1)}% WR ·{' '}
            {p.overall_adr.toFixed(1)} ADR
          </div>
        </Link>
      ))}
    </div>
  );
}

function ActiveSeasonCard({
  season,
  leaderboard,
}: {
  season: Season;
  leaderboard: LeaderboardRowWithId[];
}) {
  const sorted = podiumSort(leaderboard);
  const hasData = sorted.some((r) => r.total_rounds_played > 0);
  const top3 = sorted.slice(0, 3);

  return (
    <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border-tertiary)] rounded-[var(--radius-lg)] overflow-hidden mb-2 hover:border-[var(--color-border-primary)] transition-colors">
      <Link href={`/seasons/${season.id}`} className="block">
        <div className={`p-4 ${hasData ? 'border-b border-[var(--color-border-tertiary)]' : ''}`}>
          <span className="inline-block text-[11px] font-medium tracking-wider px-2 py-0.5 rounded mb-2 bg-[var(--color-accent-green-bg)] text-[var(--color-accent-green-fg)]">
            Active
          </span>
          <div className="text-lg font-medium mb-0.5">{season.name}</div>
          <div className="text-[13px] text-[var(--color-text-secondary)]">
            {leaderboard.length} players
          </div>
        </div>
      </Link>
      {hasData && <PodiumStrip top3={top3} />}
    </div>
  );
}

function PastSeasonCard({
  season,
  leaderboard,
}: {
  season: Season;
  leaderboard: LeaderboardRowWithId[];
}) {
  const sorted = podiumSort(leaderboard);
  const winner = sorted[0];
  const playerCount = leaderboard.length;
  const numMatch = season.name.match(/Season\s+(\d+)/i);
  const num = numMatch ? numMatch[1] : season.id;

  return (
    <Link
      href={`/seasons/${season.id}`}
      className="block bg-[var(--color-bg-primary)] border border-[var(--color-border-tertiary)] rounded-[var(--radius-lg)] mb-2.5 overflow-hidden hover:border-[var(--color-border-primary)] transition-colors"
    >
      <div className="flex items-stretch">
        <div className="px-4 py-3.5 flex flex-col justify-center min-w-[100px] border-r border-[var(--color-border-tertiary)]">
          <div className="text-[11px] font-medium tracking-wider text-[var(--color-text-secondary)] uppercase mb-1">
            Season
          </div>
          <div className="text-[22px] font-medium leading-none">{num}</div>
          <div className="text-xs text-[var(--color-text-secondary)] mt-1.5">
            {playerCount} players
          </div>
        </div>
        <div className="px-4 py-3.5 flex flex-col justify-center flex-1">
          <div className="text-[11px] font-medium tracking-wider text-[var(--color-text-secondary)] uppercase mb-1.5">
            🏆 Winner
          </div>
          {winner ? (
            <>
              <div className="text-[17px] font-medium mb-2">
                {winner.player_name}
              </div>
              <div className="flex gap-3.5">
                <Stat
                  v={`${winner.win_rate_percentage.toFixed(1)}%`}
                  l="Win rate"
                />
                <Stat v={winner.overall_adr.toFixed(1)} l="ADR" />
                <Stat v={winner.kd_ratio.toFixed(2)} l="K/D" />
              </div>
            </>
          ) : (
            <div className="text-[13px] text-[var(--color-text-secondary)]">
              No data
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div>
      <div className="text-[13px] font-medium tnum">{v}</div>
      <div className="text-[11px] text-[var(--color-text-secondary)]">{l}</div>
    </div>
  );
}

export default async function Home() {
  const [seasons, leaderboards] = await Promise.all([
    getSeasons(),
    getAllLeaderboards(),
  ]);

  const active = seasons.filter((s) => s.status === 'ACTIVE');
  const past = seasons
    .filter((s) => s.status !== 'ACTIVE' && s.status !== 'UPCOMING')
    .sort((a, b) => b.id - a.id);

  return (
    <div className="min-h-screen bg-[var(--color-bg-tertiary)]">
      <Topbar />
      <main className="px-5 py-5 max-w-[660px] mx-auto">
        <SectionLabel>Active Season</SectionLabel>
        {active.length === 0 ? (
          <div className="text-[13px] text-[var(--color-text-secondary)]">
            No active season.
          </div>
        ) : (
          active.map((s) => (
            <ActiveSeasonCard
              key={s.id}
              season={s}
              leaderboard={leaderboards.get(s.id) ?? []}
            />
          ))
        )}

        <SectionLabel>Past Seasons</SectionLabel>
        {past.length === 0 ? (
          <div className="text-[13px] text-[var(--color-text-secondary)]">
            No completed seasons yet.
          </div>
        ) : (
          past.map((s) => (
            <PastSeasonCard
              key={s.id}
              season={s}
              leaderboard={leaderboards.get(s.id) ?? []}
            />
          ))
        )}

        <SectionLabel>Career Stats</SectionLabel>
        <Link
          href="/players"
          className="block bg-[var(--color-bg-primary)] border border-[var(--color-border-tertiary)] rounded-[var(--radius-lg)] p-4 hover:border-[var(--color-border-primary)] transition-colors"
        >
          <div className="text-[13px] font-medium">All-time leaderboard</div>
          <div className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Career stats across every season
          </div>
        </Link>
      </main>
    </div>
  );
}
