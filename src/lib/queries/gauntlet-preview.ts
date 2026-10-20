import { seasonTitle } from '../util';
import type { PreviewStanding } from '../gauntlet-preview';
import { getSeasons } from './seasons';
import { getAllLeaderboards } from './leaderboard';

/** A regular season's current standings, offered in the Gauntlet Preview so seeds read as names. */
export interface GauntletPreviewSeason {
  seasonId: number;
  label: string;
  /** Canonical-sort order — index 0 is seed 1. */
  standings: PreviewStanding[];
}

/** Every regular season with at least one ranked player, newest first, with its standings in
 *  canonical-sort order (`getAllLeaderboards()`) — what the Gauntlet Preview
 *  (`/tools/gauntlet-preview`) maps seeds onto. Gauntlet seasons are excluded: seeds always come
 *  from a regular season. */
export async function getGauntletPreviewData(): Promise<GauntletPreviewSeason[]> {
  const [seasons, leaderboards] = await Promise.all([getSeasons(), getAllLeaderboards()]);
  return seasons
    .filter((s) => !s.is_gauntlet)
    .sort((a, b) => b.id - a.id)
    .map((s) => ({
      seasonId: s.id,
      label: seasonTitle(s.name),
      standings: (leaderboards.get(s.id) ?? []).map((r) => ({ playerId: r.player_id, name: r.player_name })),
    }))
    .filter((s) => s.standings.length > 0);
}
