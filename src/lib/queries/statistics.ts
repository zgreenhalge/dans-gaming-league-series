import { getAllMatchesWithPickBan, type MapMatchRow } from './maps';
import { getSabremetricSeasonTotals, type SabremetricMatchRow } from './sabremetrics';
import { getAllMatchRounds, type MatchRoundRow } from './rounds';
import { getAllMatchKills, type MatchKillRow } from './kills';
import { getAllWeaponClassStats, getAllEconomyStats, type WeaponClassMatchRow, type EconomyMatchRow } from './weaponStats';

// The Statistics page's second tier: everything its Stats, Advanced Stats and H2H tabs read. The page
// streams it in behind its first paint (`src/app/statistics/page.tsx`), since the default Leaderboard
// tab needs none of it.

/** League-wide per-match rows for the Statistics page's Stats, Advanced Stats and H2H tabs. */
export interface StatisticsDetail {
  allMatches: MapMatchRow[];
  allSabremetrics: SabremetricMatchRow[];
  allMatchRounds: MatchRoundRow[];
  allMatchKills: MatchKillRow[];
  allWeaponClassStats: WeaponClassMatchRow[];
  allEconomyStats: EconomyMatchRow[];
}

/** `StatisticsDetail`, fetched in parallel. Its reads share the request's cached `players` /
 *  `player_match_stats` / `matches` reads with the page's first tier. */
export async function getStatisticsDetail(): Promise<StatisticsDetail> {
  const [allMatches, allSabremetrics, allMatchRounds, allMatchKills, allWeaponClassStats, allEconomyStats] = await Promise.all([
    getAllMatchesWithPickBan(),
    getSabremetricSeasonTotals(),
    getAllMatchRounds(),
    getAllMatchKills(),
    getAllWeaponClassStats(),
    getAllEconomyStats(),
  ]);
  return { allMatches, allSabremetrics, allMatchRounds, allMatchKills, allWeaponClassStats, allEconomyStats };
}
