import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import type { Metadata } from 'next';
import { TopbarShell } from '@/components/TopbarShell';
import {
  getSeason,
  getSeasonLeaderboard,
  getSeasonSchedule,
  getGauntletRounds,
  getGauntletSeasonLeaderboard,
  getLinkedGauntlet,
  getLinkedRegularSeason,
  getH2HData,
  getSeasonEhogRatings,
  getAllSabremetrics,
  type WeekWithMatches,
  type GauntletRound,
} from '@/lib/queries';
import SeasonTabView from '@/components/SeasonTabView';
import CombinedSeasonTabView from '@/components/CombinedSeasonTabView';
import type { Season } from '@/lib/types';
import SeasonStartDateButton from '@/components/SeasonStartDateButton';
import MarkSeasonActiveButton from '@/components/MarkSeasonActiveButton';
import { authOptions } from '@/lib/authOptions';
import { supabase } from '@/lib/supabase';
import { seasonTitle } from '@/lib/util';

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const seasonId = Number(id);
  const season = await getSeason(seasonId);
  if (!season) return { title: 'Season' };

  const title = seasonTitle(season.name);
  const statusLabel = season.status === 'ACTIVE' ? ' · Live' : season.status === 'UPCOMING' ? ' · Soon' : '';
  const description = `${title}${statusLabel} — standings, schedule, and match results in DGLS.`;

  return {
    title: season.name,
    description,
    openGraph: {
      title: `DGLS · ${title}`,
      description,
    },
    twitter: {
      card: 'summary_large_image',
      title: `DGLS · ${title}`,
      description,
    },
  };
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
        { label: seasonTitle(season.name) },
      ]}
    />
  );
}

function SeasonStatusTag({ status }: { status: Season['status'] }) {
  if (status === 'ACTIVE') {
    return (
      <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 tracked text-[10px] font-semibold text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border border-[var(--color-accent-green-border)] shrink-0">
        <span className="live-dot w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green-fill)]" />
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
    const linked = await getLinkedRegularSeason(season.name);
    if (linked) redirect(`/seasons/${linked.id}`);

    // Orphan gauntlet with no paired regular season — render standalone
    const [rounds, leaderboard, h2hData, ehogRatings, sabremetrics] = await Promise.all([
      getGauntletRounds(seasonId),
      getGauntletSeasonLeaderboard(seasonId),
      getH2HData({ filter: seasonId, includeRegular: false, includeGauntlet: true }),
      getSeasonEhogRatings(seasonId),
      getAllSabremetrics(seasonId),
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
                {seasonTitle(season.name)}
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
          <SeasonTabView
            kind="gauntlet"
            rounds={rounds}
            leaderboard={leaderboard}
            seasonStatus={season.status}
            currentPlayerId={currentPlayerId}
            h2hData={h2hData}
            ehogRatings={ehogRatings}
            sabremetrics={sabremetrics}
          />
        </main>
      </div>
    );
  }

  // Regular season — check for paired gauntlet
  const linkedGauntlet = await getLinkedGauntlet(season.name);

  const [leaderboard, schedule, gauntletRounds, gauntletLeaderboard, h2hData, gauntletH2hData, ehogRatings, gauntletEhogRatings, sabremetrics, gauntletSabremetrics] = await Promise.all([
    getSeasonLeaderboard(seasonId),
    getSeasonSchedule(seasonId),
    linkedGauntlet ? getGauntletRounds(linkedGauntlet.id) : Promise.resolve(null),
    linkedGauntlet ? getGauntletSeasonLeaderboard(linkedGauntlet.id) : Promise.resolve(null),
    getH2HData({ filter: seasonId, includeRegular: true, includeGauntlet: false }),
    linkedGauntlet
      ? getH2HData({ filter: seasonId, includeRegular: false, includeGauntlet: true })
      : Promise.resolve(null),
    getSeasonEhogRatings(seasonId),
    linkedGauntlet ? getSeasonEhogRatings(linkedGauntlet.id) : Promise.resolve(null),
    getAllSabremetrics(seasonId),
    linkedGauntlet ? getAllSabremetrics(linkedGauntlet.id) : Promise.resolve([]),
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
              {seasonTitle(season.name)}
            </div>
          </div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5">
            {leaderboard.length} players · {matchCount} matches · {schedule.length} weeks
          </div>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <SeasonStartDateButton
              seasonId={season.id}
              startDate={season.start_date}
              canEdit={isAdmin && season.status !== 'ARCHIVED'}
              seasonStatus={season.status}
            />
            <MarkSeasonActiveButton
              seasonId={season.id}
              canEdit={isAdmin}
              seasonStatus={season.status}
            />
          </div>
        </div>
        {linkedGauntlet && gauntletRounds && gauntletLeaderboard && gauntletH2hData ? (
          <CombinedSeasonTabView
            leaderboard={leaderboard}
            schedule={schedule}
            seasonStartDate={season.start_date}
            seasonStatus={season.status}
            gauntletRounds={gauntletRounds}
            gauntletLeaderboard={gauntletLeaderboard}
            gauntletStatus={linkedGauntlet.status}
            currentPlayerId={currentPlayerId}
            h2hData={h2hData}
            gauntletH2hData={gauntletH2hData}
            ehogRatings={ehogRatings}
            gauntletEhogRatings={gauntletEhogRatings ?? undefined}
            sabremetrics={sabremetrics}
            gauntletSabremetrics={gauntletSabremetrics}
          />
        ) : (
          <SeasonTabView
            kind="regular"
            leaderboard={leaderboard}
            schedule={schedule}
            seasonStartDate={season.start_date}
            seasonStatus={season.status}
            currentPlayerId={currentPlayerId}
            h2hData={h2hData}
            ehogRatings={ehogRatings}
            sabremetrics={sabremetrics}
          />
        )}
      </main>
    </div>
  );
}
