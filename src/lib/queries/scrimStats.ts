import { getAdminClient } from '../supabase-admin';
import { isPlayedScore } from '../util';
import type { MatchPickBanInput, RoundOutcome } from '../mapSideStats';
import { getPlayersById } from './player';
import { getMatchKills, type MatchKillRow } from './kills';
import { getMatchSabremetrics } from './match';
import { getMatchRoundOutcomes } from './rounds';
import type { SabremetricStatRow } from './sabremetrics';
import { getMatchEconomyStats, getMatchWeaponClassStats, type EconomyMatchRow, type WeaponClassMatchRow } from './weaponStats';
import { getScrimNightMatches, type ScrimMatch } from './scrims';

/** What a scrim night's Stats and Advanced Stats tabs show, over the night's scored matches — the
 *  same shapes `BasicStatsView` and `SabremetricsLeaderboardView` take for a season. */
export interface ScrimNightStatsView {
  /** Each match's map and starting side, for the Sides sub-tab. A scrim match has no pick/ban. */
  matches: MatchPickBanInput[];
  rounds: RoundOutcome[];
  sabremetrics: SabremetricStatRow[];
  kills: MatchKillRow[];
  weaponClassStats: WeaponClassMatchRow[];
  economyStats: EconomyMatchRow[];
}

/** A scored scrim match as the Sides sub-tab's input: its map as the pick, no bans. */
function toPickBanInput(m: ScrimMatch): MatchPickBanInput {
  return {
    final_score: m.final_score,
    shirts_pick: m.map,
    skins_pick: null,
    skins_starting_side: m.skins_starting_side,
    shirts_stats: m.players.filter((p) => p.faction === 'SHIRTS'),
    skins_stats: m.players.filter((p) => p.faction === 'SKINS'),
  };
}

/** The stat data for a scrim night's scored matches: each match's per-match reads (the ones its own
 *  page uses), concatenated. Not cached as a whole — a night in progress gains a match — but each
 *  per-match read is. */
export async function getScrimNightStatsView(nightId: number): Promise<ScrimNightStatsView> {
  const scored = (await getScrimNightMatches(nightId)).filter((m) => isPlayedScore(m.final_score));
  const ids = scored.map((m) => m.id);
  const playersById = getPlayersById();
  const [sabremetrics, kills, weaponClassStats, economyStats, rounds] = await Promise.all([
    Promise.all(ids.map((id) => getMatchSabremetrics(id))),
    Promise.all(ids.map((id) => getMatchKills(id, playersById))),
    Promise.all(ids.map((id) => getMatchWeaponClassStats(id, playersById))),
    Promise.all(ids.map((id) => getMatchEconomyStats(id, playersById))),
    getMatchRoundOutcomes(ids),
  ]);
  const roundsPlayed = new Map(scored.flatMap((m) => m.players.map((p) => [`${m.id}:${p.player_id}`, p.rounds_played] as const)));
  return {
    matches: scored.map(toPickBanInput),
    rounds,
    sabremetrics: sabremetrics.flatMap((rows, i) =>
      rows.map((sab) => ({
        player_id: sab.player_id,
        player_name: sab.player_name,
        match_id: ids[i],
        rounds_played: roundsPlayed.get(`${ids[i]}:${sab.player_id}`) ?? 0,
        sab,
      })),
    ),
    kills: kills.flat(),
    weaponClassStats: weaponClassStats.flat(),
    economyStats: economyStats.flat(),
  };
}

/** Whether any of the given scored scrim matches has parsed sabremetrics — the gate for a night's
 *  Advanced Stats tab, without fetching the data itself (see `getScrimNightStatsView()`). */
export async function hasScrimMatchSabremetrics(matchIds: number[]): Promise<boolean> {
  if (matchIds.length === 0) return false;
  const { data: pms, error: pmsError } = await getAdminClient().from('player_match_stats').select('id').in('match_id', matchIds);
  if (pmsError) throw pmsError;
  if (!pms || pms.length === 0) return false;
  const { data, error } = await getAdminClient()
    .from('player_match_sabremetrics')
    .select('player_match_stats_id')
    .in('player_match_stats_id', pms.map((r) => r.id))
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}
