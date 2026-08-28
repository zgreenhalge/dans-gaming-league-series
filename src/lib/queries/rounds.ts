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

/** Every round's `shirts_side`, keyed by `` `${match_id}:${round_number}` `` — the raw ingredient
 *  `resolvePlayerSide()` (`queries/kills.ts`) needs to resolve which side a player was on a given
 *  round. No season resolution or `winner_side`/`win_reason` join, unlike `getAllMatchRounds()` —
 *  side-split derivation doesn't need either, the same reasoning `getAllKillCreditFlags()`
 *  (`queries/kills.ts`) uses to skip `getAllMatchKills()`'s season/name joins. Pass `matchId` to
 *  scope to one match. */
export async function getRoundSides(matchId?: number): Promise<Map<string, 'CT' | 'T'>> {
  const rows = await fetchAllPages<{ match_id: number; round_number: number; shirts_side: string }>(
    (from, to) => {
      let q = supabase.from('match_rounds').select('match_id, round_number, shirts_side');
      if (matchId != null) q = q.eq('match_id', matchId);
      return q.range(from, to);
    },
  );
  return new Map(rows.map((r) => [`${r.match_id}:${r.round_number}`, r.shirts_side as 'CT' | 'T']));
}
