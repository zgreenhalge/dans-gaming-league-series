import { TopbarShell } from '@/components/TopbarShell';
import {
  getCareerLeaderboard,
  getAllLeaderboards,
  getSeasons,
} from '@/lib/queries';
import CareerStatsView from '@/components/CareerStatsView';
import type { LeaderboardRowWithId } from '@/lib/types';

export const revalidate = 60;

export const metadata = { title: 'Statistics' };

export default async function StatisticsPage() {
  const [careerRows, allLeaderboards, seasons] = await Promise.all([
    getCareerLeaderboard(),
    getAllLeaderboards(),
    getSeasons(),
  ]);

  const bySeason: Record<number, LeaderboardRowWithId[]> = {};
  for (const [sid, rows] of allLeaderboards) bySeason[sid] = rows;

  const seasonsWithData = seasons.filter((s) =>
    (bySeason[s.id] ?? []).some((r) => r.total_rounds_played > 0),
  );

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
          seasons={seasonsWithData.map((s) => ({ id: s.id, name: s.name }))}
          careerRows={careerRows}
          bySeason={bySeason}
        />
      </main>
    </div>
  );
}
