import { supabase } from '../supabase';
import { fetchAllPages, fetchPmsLookup, type PmsRow } from './_shared';

/** One `match_round_economy` row, joined to player ids — the round-grain counterpart of
 *  `getMatchEconomyStats()`'s tier-bucketed aggregate (`queries/weaponStats.ts`), for views that
 *  plot equipment value across the match (round by round) rather than summarizing it by
 *  eco/force/full tier — e.g. the Economy sub-tab's round-by-round chart. */
export interface MatchRoundEconomyRow {
  match_id: number;
  round_number: number;
  player_id: number;
  economy_type: string;
  equipment_value: number;
}

type RawRoundEconomyRow = {
  match_id: number;
  round_number: number;
  player_match_stats_id: number;
  economy_type: string;
  equipment_value: number;
};

function joinRoundEconomyRows(rows: RawRoundEconomyRow[], pmsLookup: Map<number, PmsRow>): MatchRoundEconomyRow[] {
  const result: MatchRoundEconomyRow[] = [];
  for (const r of rows) {
    const pms = pmsLookup.get(r.player_match_stats_id);
    if (!pms) continue;
    result.push({
      match_id: r.match_id,
      round_number: r.round_number,
      player_id: pms.player_id,
      economy_type: r.economy_type,
      equipment_value: r.equipment_value,
    });
  }
  return result;
}

/** One match's recorded per-round equipment values (`match_round_economy`), joined to player ids. */
export async function getMatchRoundEconomy(matchId: number): Promise<MatchRoundEconomyRow[]> {
  const [rows, pmsLookup] = await Promise.all([
    fetchAllPages<RawRoundEconomyRow>((from, to) =>
      supabase.from('match_round_economy').select('*').eq('match_id', matchId).range(from, to),
    ),
    fetchPmsLookup(matchId),
  ]);
  return joinRoundEconomyRows(rows, pmsLookup);
}
