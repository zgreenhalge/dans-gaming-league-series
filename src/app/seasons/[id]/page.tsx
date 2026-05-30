import Link from 'next/link';
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
import LeaderboardTable from '@/components/LeaderboardTable';
import GauntletStandings from '@/components/GauntletStandings';
import ScheduleList from '@/components/ScheduleList';
import GauntletRoundsList from '@/components/GauntletRoundsList';
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

function TabBar({
  seasonId,
  tabs,
  activeTab,
}: {
  seasonId: number;
  tabs: { key: string; label: string }[];
  activeTab: string;
}) {
  return (
    <div className="flex border-b border-[var(--color-border-primary)] mb-6">
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <Link
            key={tab.key}
            href={`/seasons/${seasonId}?tab=${tab.key}`}
            className={`px-4 py-2.5 tracked text-[11px] font-semibold transition-colors -mb-px border-b-2 ${
              isActive
                ? 'text-[var(--color-text-primary)] border-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] border-transparent hover:text-[var(--color-text-primary)]'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SeasonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
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
    const activeTab = tab === 'rounds' ? 'rounds' : 'standings';

    return (
      <div className="min-h-screen">
        <Topbar season={season} />
        <main className="max-w-[1080px] mx-auto px-6 pb-16">
          <div className="mt-8 mb-6">
            <div className="font-display text-[36px] font-semibold leading-tight">
              {season.name}
            </div>
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5">
              {matchCount} matches · {rounds.length} rounds
            </div>
            <div className="mt-2">
              <SeasonStartDateButton
                seasonId={season.id}
                startDate={season.start_date}
                canEdit={isAdmin}
              />
            </div>
          </div>

          <TabBar
            seasonId={season.id}
            activeTab={activeTab}
            tabs={[
              { key: 'standings', label: 'Standings' },
              { key: 'rounds', label: 'Rounds' },
            ]}
          />

          {activeTab === 'standings' && (
            <>
              <GauntletStandings rounds={rounds} leaderboard={leaderboard} />
              <div className="tracked text-[10px] text-[var(--color-text-secondary)] mt-10 mb-3">
                Stats
              </div>
              {leaderboard.length === 0 ? (
                <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
                  No stats recorded yet.
                </div>
              ) : (
                <LeaderboardTable rows={leaderboard} showMedals={false} />
              )}
            </>
          )}

          {activeTab === 'rounds' && (
            <GauntletRoundsList rounds={rounds} currentPlayerId={currentPlayerId} />
          )}
        </main>
      </div>
    );
  }

  const [leaderboard, schedule] = await Promise.all([
    getSeasonLeaderboard(seasonId),
    getSeasonSchedule(seasonId),
  ]);
  const matchCount = countMatches(schedule);
  const activeTab = tab === 'schedule' ? 'schedule' : 'leaderboard';

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
          <div className="mt-2">
            <SeasonStartDateButton
              seasonId={season.id}
              startDate={season.start_date}
              canEdit={isAdmin}
            />
          </div>
        </div>

        <TabBar
          seasonId={season.id}
          activeTab={activeTab}
          tabs={[
            { key: 'leaderboard', label: 'Leaderboard' },
            { key: 'schedule', label: 'Schedule' },
          ]}
        />

        {activeTab === 'leaderboard' && (
          leaderboard.length === 0 ? (
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
              No leaderboard data yet.
            </div>
          ) : (
            <LeaderboardTable
              rows={leaderboard}
              showMedals={season.status === 'COMPLETED'}
              playoffZones={season.status === 'ACTIVE' ? { top: 2, bottom: 4 } : undefined}
            />
          )
        )}

        {activeTab === 'schedule' && (
          <ScheduleList
            schedule={schedule}
            seasonStartDate={season.start_date}
            currentPlayerId={currentPlayerId}
          />
        )}
      </main>
    </div>
  );
}
