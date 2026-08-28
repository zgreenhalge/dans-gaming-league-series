import { Suspense } from 'react';
import { TopbarShell } from '@/components/TopbarShell';
import {
  getCareerLeaderboard,
  getAllLeaderboards,
  getSeasons,
  getGauntletStats,
  getAllSeasonMedalists,
  getPlayersById,
  getAllMatchesWithPickBan,
  getAllEhogSnapshots,
  getSabremetricSeasonTotals,
  getAllMatchRounds,
  getAllMatchKills,
  getAllWeaponClassStats,
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
  // Shared with getAllMatchKills() below (same in-flight promise, not a second fetch).
  const playersByIdPromise = getPlayersById();
  const [careerRows, allLeaderboards, seasons, gauntletStats, medalists, playersById, allMatches, ehogSnapshots, allSabremetrics, allMatchRounds, allMatchKills, allWeaponClassStats] =
    await Promise.all([
      getCareerLeaderboard(),
      getAllLeaderboards(),
      getSeasons(),
      getGauntletStats(),
      getAllSeasonMedalists(),
      playersByIdPromise,
      getAllMatchesWithPickBan(),
      getAllEhogSnapshots(),
      getSabremetricSeasonTotals(),
      getAllMatchRounds(),
      getAllMatchKills(undefined, playersByIdPromise),
      getAllWeaponClassStats(undefined, playersByIdPromise),
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
              allMatches={allMatches}
              ehogSnapshots={ehogSnapshots}
              allSabremetrics={allSabremetrics}
              allMatchRounds={allMatchRounds}
              allMatchKills={allMatchKills}
              allWeaponClassStats={allWeaponClassStats}
            />
          </UrlStateProvider>
        </Suspense>
      </main>
    </div>
  );
}
