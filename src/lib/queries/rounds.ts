import { supabase } from '../supabase';
import { resolveMatchSeasons, fetchAllPages } from './_shared';

export interface MatchRoundRow {
  match_id: number;
  season_id: number;
  round_number: number;
  winner_side: 'CT' | 'T';
  shirts_side: 'CT' | 'T';
  win_reason: string | null;
}

type RawRoundRow = {
  match_id: number;
  round_number: number;
  winner_side: string;
  shirts_side: string;
  win_reason: string | null;
};

/** Every recorded round outcome (`match_rounds`), joined to season — the raw ingredient behind
 *  round-win-%-by-side. Flat, ungrouped, matching `getAllMatchKills()`'s pattern. */
export async function getAllMatchRounds(seasonId?: number): Promise<MatchRoundRow[]> {
  const [roundRows, matchSeason] = await Promise.all([
    fetchAllPages<RawRoundRow>((from, to) => supabase.from('match_rounds').select('*').range(from, to)),
    resolveMatchSeasons(),
  ]);

  const result: MatchRoundRow[] = [];
  for (const r of roundRows) {
    const sid = matchSeason.get(r.match_id);
    if (sid == null) continue;
    if (seasonId != null && sid !== seasonId) continue;
    result.push({
      match_id: r.match_id,
      season_id: sid,
      round_number: r.round_number,
      winner_side: r.winner_side as 'CT' | 'T',
      shirts_side: r.shirts_side as 'CT' | 'T',
      win_reason: r.win_reason,
    });
  }
  return result;
}

/** Groups rounds by `match_id` — the shape `aggregatePlayerSideStats()`'s `roundsByMatch` param
 *  and `BasicStatsView`'s per-match lookups both want. */
export function groupRoundsByMatch(rounds: MatchRoundRow[]): Map<number, MatchRoundRow[]> {
  const byMatch = new Map<number, MatchRoundRow[]>();
  for (const r of rounds) {
    let list = byMatch.get(r.match_id);
    if (!list) {
      list = [];
      byMatch.set(r.match_id, list);
    }
    list.push(r);
  }
  return byMatch;
}
