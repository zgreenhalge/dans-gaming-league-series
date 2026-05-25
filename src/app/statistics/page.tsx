import { TopbarShell } from '@/components/TopbarShell';
import {
  getCareerLeaderboard,
  getAllLeaderboards,
  getSeasons,
  getGauntletStats,
} from '@/lib/queries';
import CareerStatsView from '@/components/CareerStatsView';
import type { LeaderboardRowWithId } from '@/lib/types';

export const revalidate = 60;

export const metadata = { title: 'Statistics' };

export default async function StatisticsPage() {
  const [careerRows, allLeaderboards, seasons, gauntletStats] =
    await Promise.all([
      getCareerLeaderboard(),
      getAllLeaderboards(),
      getSeasons(),
      getGauntletStats(),
    ]);

  const bySeason: Record<number, LeaderboardRowWithId[]> = {};
  for (const [sid, rows] of allLeaderboards) bySeason[sid] = rows;

  const regularSeasons = seasons
    .filter((s) => !s.is_gauntlet)
    .filter((s) => (bySeason[s.id] ?? []).some((r) => r.total_rounds_played > 0));

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
        <CareerStatsView
          regularSeasons={regularSeasons.map((s) => ({ id: s.id, name: s.name }))}
          gauntletSeasons={gauntletSeasons.map((s) => ({ id: s.id, name: s.name }))}
          careerRows={careerRows}
          bySeason={bySeason}
          gauntletCareerRows={gauntletStats.career}
          gauntletBySeason={gauntletStats.bySeason}
        />
      </main>
    </div>
  );
}
