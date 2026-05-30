import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { TopbarShell } from '@/components/TopbarShell';
import {
  getSeason,
  getSeasonLeaderboard,
  getSeasonSchedule,
  getGauntletRounds,
  getGauntletSeasonLeaderboard,
  type WeekWithMatches,
  type GauntletRound,
} from '@/lib/queries';
import RegularSeasonTabView from '@/components/RegularSeasonTabView';
import GauntletTabView from '@/components/GauntletTabView';
import type { Season } from '@/lib/types';
import SeasonStartDateButton from '@/components/SeasonStartDateButton';
import { authOptions } from '@/lib/authOptions';
import { supabase } from '@/lib/supabase';

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

function countGauntletMatches(rounds: GauntletRound[]) {
  return rounds.reduce((sum, r) => sum + r.matches.length, 0);
}

function Topbar({ season }: { season: Season }) {
  return (
    <TopbarShell
      crumbs={[
        { label: 'DGLS', href: '/' },
        { label: season.name },
      ]}
    />
  );
}

function SeasonStatusTag({ status }: { status: Season['status'] }) {
  if (status === 'ACTIVE') {
    return (
      <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 tracked text-[10px] font-semibold text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border border-[var(--color-accent-green-border)] shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green-fill)] animate-pulse" />
        Live
      </span>
    );
  }
  if (status === 'UPCOMING') {
    return (
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
    );
  }
  return null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SeasonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) notFound();

  const season = await getSeason(seasonId);
  if (!season) notFound();

  const session = await getServerSession(authOptions);
  const currentPlayerId = session?.user?.playerId ?? null;
  let isAdmin = false;
  if (session?.user?.playerId) {
    const { data: playerRow } = await supabase
      .from('players')
      .select('is_admin')
      .eq('id', session.user.playerId)
      .maybeSingle();
    isAdmin = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
  }

  if (season.is_gauntlet) {
    const [rounds, leaderboard] = await Promise.all([
      getGauntletRounds(seasonId),
      getGauntletSeasonLeaderboard(seasonId),
    ]);
    const matchCount = countGauntletMatches(rounds);

    return (
      <div className="min-h-screen">
        <Topbar season={season} />
        <main className="max-w-[1080px] mx-auto px-6 pb-16">
          <div className="mt-8 mb-6">
            <div className="flex items-center gap-3">
              <SeasonStatusTag status={season.status} />
              <div className="font-display text-[36px] font-semibold leading-tight">
                {season.name}
              </div>
            </div>
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5">
              {matchCount} matches · {rounds.length} rounds
            </div>
            <div className="mt-2">
              <SeasonStartDateButton
                seasonId={season.id}
                startDate={season.start_date}
                canEdit={isAdmin && season.status !== 'ARCHIVED'}
                seasonStatus={season.status}
              />
            </div>
          </div>
          <GauntletTabView
            rounds={rounds}
            leaderboard={leaderboard}
            seasonStatus={season.status}
            currentPlayerId={currentPlayerId}
          />
        </main>
      </div>
    );
  }

  const [leaderboard, schedule] = await Promise.all([
    getSeasonLeaderboard(seasonId),
    getSeasonSchedule(seasonId),
  ]);
  const matchCount = countMatches(schedule);

  return (
    <div className="min-h-screen">
      <Topbar season={season} />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="flex items-center gap-3">
            <SeasonStatusTag status={season.status} />
            <div className="font-display text-[36px] font-semibold leading-tight">
              {season.name}
            </div>
          </div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5">
            {leaderboard.length} players · {matchCount} matches · {schedule.length} weeks
          </div>
          <div className="mt-2">
            <SeasonStartDateButton
              seasonId={season.id}
              startDate={season.start_date}
              canEdit={isAdmin && season.status !== 'ARCHIVED'}
              seasonStatus={season.status}
            />
          </div>
        </div>
        <RegularSeasonTabView
          leaderboard={leaderboard}
          schedule={schedule}
          seasonStartDate={season.start_date}
          seasonStatus={season.status}
          currentPlayerId={currentPlayerId}
        />
      </main>
    </div>
  );
}
