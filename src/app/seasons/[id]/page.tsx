import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import {
  getSeason,
  getSeasonLeaderboard,
  getSeasonSchedule,
  type WeekWithMatches,
  type MatchWithRoster,
} from '@/lib/queries';
import LeaderboardTable from '@/components/LeaderboardTable';
import type { Season } from '@/lib/types';
import { isPlayedScore } from '@/lib/util';
import { mapImageFor } from '@/lib/maps';

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const season = await getSeason(Number(id));
  return { title: season?.name ?? 'Season' };
}


function countMatches(schedule: WeekWithMatches[]) {
  return schedule.reduce((sum, w) => sum + w.matches.length, 0);
}

function Topbar({ season }: { season: Season }) {
  const isActive = season.status === 'ACTIVE';
  return (
    <TopbarShell
      crumbs={[
        { label: 'DGLS', href: '/' },
        { label: season.name },
      ]}
      nav={
        isActive ? (
          <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 tracked text-[10px] font-semibold text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border border-[var(--color-accent-green-border)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green-fill)] animate-pulse" />
            Live
          </span>
        ) : undefined
      }
    />
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="tracked text-[10px] text-[var(--color-text-secondary)] mt-10 mb-3">
      {children}
    </div>
  );
}


function MatchRow({ match }: { match: MatchWithRoster }) {
  const played = isPlayedScore(match.final_score);
  const map = match.shirts_pick ?? match.picked_map;
  const mapImg = mapImageFor(map);
  const shirtsLabel =
    match.shirts.map((p) => p.player_name).join(' & ') || 'Shirts TBD';
  const skinsLabel =
    match.skins.map((p) => p.player_name).join(' & ') || 'Skins TBD';

  return (
    <Link
      href={`/matches/${match.id}`}
      className={`block border-b border-[var(--color-border-tertiary)] last:border-b-0 transition-colors ${mapImg ? 'map-card-bg' : 'hover:bg-[var(--color-bg-secondary)]'}`}
      style={mapImg ? ({ ['--map-img' as string]: `url("${mapImg}")` } as React.CSSProperties) : undefined}
    >
      <div className={`px-4 py-3 ${mapImg ? 'bg-[rgba(0,0,0,0.28)] hover:bg-[rgba(0,0,0,0.18)] transition-colors' : ''}`}>
        <div className="flex items-center justify-between gap-3 mb-1">
          <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
            #{match.match_number}
          </span>
          {played ? (
            <span className="font-mono text-[13px] font-semibold tnum text-[var(--color-text-primary)] whitespace-nowrap">
              {match.final_score}
            </span>
          ) : (
            <span className="inline-flex items-center px-1.5 py-0.5 tracked text-[9px] font-semibold text-[var(--color-accent-amber-fg)] bg-[var(--color-accent-amber-bg)] border border-[var(--color-accent-amber-border)] whitespace-nowrap">
              Pending
            </span>
          )}
        </div>
        {map && (
          <div className="font-display text-[15px] font-semibold leading-tight mb-1">
            {map}
          </div>
        )}
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)] truncate">
          {shirtsLabel} <span className="opacity-50">vs</span> {skinsLabel}
        </div>
      </div>
    </Link>
  );
}

function WeekBlock({ week }: { week: WeekWithMatches }) {
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] mb-4 last:mb-0">
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)]">
        <span className="tracked text-[11px] font-semibold text-[var(--color-text-primary)]">
          Week {week.week_number}
        </span>
        {week.bye_player_name && (
          <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">
            <span className="tracked mr-1.5">Bye</span>
            {week.bye_player_name}
          </span>
        )}
      </div>
      {week.matches.map((m) => (
        <MatchRow key={m.id} match={m} />
      ))}
    </div>
  );
}

export default async function SeasonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) notFound();

  const [season, leaderboard, schedule] = await Promise.all([
    getSeason(seasonId),
    getSeasonLeaderboard(seasonId),
    getSeasonSchedule(seasonId),
  ]);
  if (!season) notFound();

  const matchCount = countMatches(schedule);

  return (
    <div className="min-h-screen">
      <Topbar season={season} />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[36px] font-semibold leading-tight">
            {season.name}
          </div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5">
            {leaderboard.length} players · {matchCount} matches · {schedule.length} weeks
          </div>
        </div>


        <SectionLabel>Leaderboard</SectionLabel>
        {leaderboard.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            No leaderboard data yet.
          </div>
        ) : (
          <LeaderboardTable rows={leaderboard} />
        )}

        <SectionLabel>Schedule</SectionLabel>
        {schedule.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            No weeks scheduled.
          </div>
        ) : (
          schedule.map((w) => <WeekBlock key={w.id} week={w} />)
        )}
      </main>
    </div>
  );
}
