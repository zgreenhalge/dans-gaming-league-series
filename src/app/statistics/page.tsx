import { Suspense } from 'react';
import { TopbarShell } from '@/components/TopbarShell';
import {
  getCareerLeaderboard,
  getAllLeaderboards,
  getSeasons,
  getGauntletStats,
  getAllSeasonMedalists,
  getPlayersById,
  getAllEhogSnapshots,
  getStatisticsDetail,
} from '@/lib/queries';
import CareerStatsView from '@/components/CareerStatsView';
import { UrlStateProvider } from '@/components/UrlStateProvider';
import type { LeaderboardRowWithId } from '@/lib/types';
import type { TrophyEntry } from '@/lib/queries';

export const revalidate = 60;

export const metadata = {
  title: 'Statistics',
  description: 'Career leaderboards, rankings, and advanced stats for all DGLS players.',
};

export default async function StatisticsPage() {
  // Two tiers. The Leaderboard tab (the default) needs only the first, which the page awaits; the
  // Stats, Advanced Stats and H2H tabs read the second (`getStatisticsDetail()`), started here so it
  // runs alongside the first but streamed to the client behind it instead of gating first paint.
  // These reads are `cache()`-wrapped (#507), so the two tiers share one read per table across this
  // render pass rather than one per caller.
  const detail = getStatisticsDetail();
  const [careerRows, allLeaderboards, seasons, gauntletStats, medalists, playersById, ehogSnapshots] =
    await Promise.all([
      getCareerLeaderboard(),
      getAllLeaderboards(),
      getSeasons(),
      getGauntletStats(),
      getAllSeasonMedalists(),
      getPlayersById(),
      getAllEhogSnapshots(),
    ]);

  // H2H is computed client-side (see CareerStatsView) so its tab can honor the
  // season filter — only the id/name/avatar players need for it are passed down.
  const players = Array.from(playersById.values()).map((p) => ({
    id: p.id,
    name: p.name,
    steam_avatar_url: p.steam_avatar_url,
  }));

  const bySeason: Record<number, LeaderboardRowWithId[]> = {};
  for (const [sid, rows] of allLeaderboards) bySeason[sid] = rows;

  const trophiesByPlayer: Record<number, TrophyEntry[]> = {};
  for (const [pid, entries] of medalists) trophiesByPlayer[pid] = entries;

  const regularSeasons = seasons
    .filter((s) => !s.is_gauntlet)
    .filter((s) => (bySeason[s.id] ?? []).length > 0);

  const gauntletSeasons = seasons
    .filter((s) => s.is_gauntlet)
    .filter((s) => (gauntletStats.bySeason[s.id] ?? []).length > 0);

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Statistics' },
        ]}
      />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[36px] font-semibold leading-tight">
            Statistics
          </div>
        </div>
        <Suspense>
          <UrlStateProvider>
            <CareerStatsView
              regularSeasons={regularSeasons.map((s) => ({ id: s.id, name: s.name }))}
              gauntletSeasons={gauntletSeasons.map((s) => ({ id: s.id, name: s.name }))}
              careerRows={careerRows}
              bySeason={bySeason}
              gauntletCareerRows={gauntletStats.career}
              gauntletBySeason={gauntletStats.bySeason}
              trophiesByPlayer={trophiesByPlayer}
              players={players}
              ehogSnapshots={ehogSnapshots}
              detail={detail}
            />
          </UrlStateProvider>
        </Suspense>
      </main>
    </div>
  );
}
